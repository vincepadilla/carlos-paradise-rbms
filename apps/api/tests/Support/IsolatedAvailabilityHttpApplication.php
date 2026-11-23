<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\User;
use App\Providers\AppServiceProvider;
use App\Services\Algorithms\ReservationAvailabilityShadow;
use Closure;
use Illuminate\Auth\AuthServiceProvider;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Cache\CacheServiceProvider;
use Illuminate\Config\Repository;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Contracts\Routing\ResponseFactory;
use Illuminate\Cookie\CookieServiceProvider;
use Illuminate\Database\Connectors\ConnectionFactory;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Exceptions\Handler;
use Illuminate\Foundation\Providers\FoundationServiceProvider;
use Illuminate\Hashing\HashServiceProvider;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Session\SessionServiceProvider;
use Illuminate\Support\Facades\Facade;
use Psr\Log\LoggerInterface;
use ReflectionProperty;
use Symfony\Component\HttpFoundation\Response;

/** Real routes/session guard with disposable fixtures and no environment/config bootstrap. */
final class IsolatedAvailabilityHttpApplication
{
    public readonly Application $app;

    public readonly AvailabilityShadowTestEnvironment $fixtures;

    private mixed $previousResolver;

    private mixed $previousDispatcher;

    private array $previousRequestMacros;

    private Closure $productionShadowFactory;

    public function __construct(ResponseFactory $responses, ?AvailabilityShadowTestEnvironment $fixtures = null,
        private readonly bool $productionShadow = false)
    {
        $this->fixtures = $fixtures ?? new AvailabilityShadowTestEnvironment;
        $this->previousResolver = Model::getConnectionResolver();
        $this->previousDispatcher = Model::getEventDispatcher();
        $this->previousRequestMacros = (new ReflectionProperty(Request::class, 'macros'))->getValue();
        $this->app = new Application(dirname(__DIR__, 2));
        $this->app->instance('config', new Repository([
            'app' => ['env' => 'testing', 'debug' => false, 'locale' => 'en', 'url' => 'http://fixture.test',
                'key' => 'fixture-only-not-a-real-key'],
            'database' => ['default' => 'fixture', 'connections' => ['fixture' => ['driver' => $this->fixtures->database->getDriverName(), 'database' => 'fixture']]],
            'auth' => ['defaults' => ['guard' => 'web'], 'guards' => ['web' => ['driver' => 'session', 'provider' => 'users']],
                'providers' => ['users' => ['driver' => 'eloquent', 'model' => User::class]]],
            'session' => ['driver' => 'array', 'cookie' => 'isolated_session', 'lifetime' => 120, 'encrypt' => false,
                'serialization' => 'php', 'lottery' => [0, 100], 'expire_on_close' => false,
                'path' => '/', 'domain' => null, 'secure' => false, 'http_only' => true, 'same_site' => 'lax'],
            'cache' => ['default' => 'array', 'stores' => ['array' => ['driver' => 'array', 'serialize' => false]]],
            'hashing' => ['driver' => 'bcrypt', 'bcrypt' => ['rounds' => 4]],
        ]));
        $database = new DatabaseManager($this->app, new ConnectionFactory($this->app));
        $database->extend('fixture', fn () => $this->fixtures->database);
        $this->app->instance('db', $database);
        $this->app->instance('db.schema', $this->fixtures->database->getSchemaBuilder());
        $this->app->instance('validator', $this->fixtures->container['validator']);
        $this->app->instance(ResponseFactory::class, $responses);
        $this->app->instance(LoggerInterface::class, $this->fixtures->logger);
        $this->app->instance(ExceptionHandler::class, new Handler($this->app));
        $this->app->instance('request', Request::create('http://fixture.test'));
        Model::setConnectionResolver($database);
        Model::setEventDispatcher($this->app['events']);
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication($this->app);
        foreach ([CookieServiceProvider::class, SessionServiceProvider::class, CacheServiceProvider::class,
            HashServiceProvider::class, AuthServiceProvider::class, AppServiceProvider::class] as $provider) {
            $this->app->register($provider);
        }
        $this->productionShadowFactory = $this->app->getBindings()[ReservationAvailabilityShadow::class]['concrete'];
        (new FoundationServiceProvider($this->app))->registerRequestValidation();
        // Never run LoadEnvironmentVariables, LoadConfiguration, or package/provider discovery.
        $this->app->bootstrapWith([]);
        $this->app->boot();
        $router = $this->app['router'];
        $router->aliasMiddleware('auth', Authenticate::class);
        $router->aliasMiddleware('throttle', ThrottleRequests::class);
        $router->middlewareGroup('web', [StartSession::class]);
        $router->group(['middleware' => 'web'], function (): void {
            require dirname(__DIR__, 2).'/routes/web.php';
        });
        $this->createAuthenticationFixtures();
    }

    public function login(int $userId): string
    {
        $session = $this->app['session.store'];
        $session->setId(null);
        $session->start();
        $this->app['auth']->forgetGuards();
        $this->app['auth']->guard('web')->loginUsingId($userId);
        $session->save();

        return $session->getId();
    }

    public function get(string $uri, array $query = [], ?string $sessionId = null, bool $shadow = false, ?Closure $treeFactory = null): Response
    {
        return $this->request('GET', $uri, $query, $sessionId, $shadow, $treeFactory);
    }

    public function post(string $uri, array $data, ?string $sessionId = null): Response
    {
        return $this->request('POST', $uri, $data, $sessionId);
    }

    private function request(string $method, string $uri, array $query, ?string $sessionId, bool $shadow = false, ?Closure $treeFactory = null): Response
    {
        $this->app->forgetScopedInstances();
        $this->app['auth']->forgetGuards();
        $this->app['config']->set('algocom.availability_shadow.enabled', $shadow);
        $this->app->scoped(ReservationAvailabilityShadow::class,
            $this->productionShadow && $treeFactory === null ? $this->productionShadowFactory
                : fn () => $this->fixtures->shadow(factory: $treeFactory));
        $request = Request::create('http://fixture.test'.$uri, $method, $query,
            $sessionId === null ? [] : ['isolated_session' => $sessionId], server: ['HTTP_ACCEPT' => 'application/json']);
        $this->app->instance('request', $request);
        $this->app['url']->setRequest($request);

        return $this->app['router']->dispatch($request);
    }

    public function close(): void
    {
        if ($this->previousResolver === null) {
            Model::unsetConnectionResolver();
        } else {
            Model::setConnectionResolver($this->previousResolver);
        }
        if ($this->previousDispatcher === null) {
            Model::unsetEventDispatcher();
        } else {
            Model::setEventDispatcher($this->previousDispatcher);
        }
        (new ReflectionProperty(Request::class, 'macros'))->setValue(null, $this->previousRequestMacros);
        $this->fixtures->close();
    }

    private function createAuthenticationFixtures(): void
    {
        $schema = $this->fixtures->database->getSchemaBuilder();
        $schema->create('roles', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->string('name');
        });
        $schema->create('users', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('role_id');
            $table->string('name');
            $table->string('email');
            $table->string('email_verified_at')->nullable();
            $table->boolean('is_active');
            $table->string('password')->nullable();
            $table->string('remember_token')->nullable();
        });
        $schema->create('villas', fn (Blueprint $table) => $table->integer('id')->primary());
        $schema->create('reservation_queue_releases', function (Blueprint $table): void {
            $table->integer('id')->primary();
            $table->integer('villa_id');
            $table->integer('opportunity_id');
            $table->timestampTz('ends_at');
            $table->integer('granted_reservation_id')->nullable();
        });
        $this->fixtures->database->table('roles')->insert([
            ['id' => 1, 'name' => 'guest'], ['id' => 2, 'name' => 'admin'], ['id' => 3, 'name' => 'owner'],
        ]);
        foreach ([[1, 1, true, true], [2, 1, false, true], [3, 2, false, true], [4, 3, false, true], [5, 2, false, false]] as [$id, $role, $verified, $active]) {
            $this->fixtures->database->table('users')->insert(['id' => $id, 'role_id' => $role,
                'name' => 'Fixture '.$id, 'email' => 'fixture'.$id.'@example.invalid',
                'email_verified_at' => $verified ? ReservationIntervalFixtures::NOW : null, 'is_active' => $active]);
        }
    }
}
