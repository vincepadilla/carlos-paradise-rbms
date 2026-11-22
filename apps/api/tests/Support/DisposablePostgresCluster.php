<?php

declare(strict_types=1);

namespace Tests\Support;

use Illuminate\Database\PostgresConnection;
use PDO;
use RuntimeException;

/** Only accepts the fresh local cluster manifest created by run-shadow-validation.ps1. */
final class DisposablePostgresCluster
{
    private array $manifest;

    public function __construct()
    {
        $manifestPath = getenv('RBMS_STEP4A_MANIFEST');
        if (! is_string($manifestPath) || ! is_file($manifestPath)) {
            throw new RuntimeException('Use the disposable PostgreSQL runner; no application DB fallback exists.');
        }
        $root = realpath(dirname($manifestPath));
        $temp = realpath(sys_get_temp_dir());
        if ($root === false || $temp === false || strcasecmp(dirname($root), $temp) !== 0
            || ! preg_match('/^rbms-step4a-[a-f0-9]{32}$/D', basename($root)) || basename($manifestPath) !== 'manifest.json') {
            throw new RuntimeException('Refusing an unowned PostgreSQL fixture manifest.');
        }
        $manifest = json_decode(file_get_contents($manifestPath), true, flags: JSON_THROW_ON_ERROR);
        if (($manifest['process_verified'] ?? false) !== true || ! is_int($manifest['port'] ?? null)
            || $manifest['port'] < 49152 || $manifest['port'] > 65535
            || ! preg_match('/^rbms_step4a_[a-f0-9]{32}$/D', $manifest['database'] ?? '')
            || ! preg_match('/^[a-f0-9]{32}$/D', $manifest['nonce'] ?? '')
            || realpath($manifest['data_directory'] ?? '') !== realpath($root.'/data')) {
            throw new RuntimeException('Disposable PostgreSQL ownership verification failed.');
        }
        $pid = file($root.'/data/postmaster.pid', FILE_IGNORE_NEW_LINES);
        if ((int) ($pid[0] ?? 0) !== ($manifest['pid'] ?? null) || (int) ($pid[3] ?? 0) !== $manifest['port']) {
            throw new RuntimeException('Disposable PostgreSQL process/port identity changed.');
        }
        $this->manifest = $manifest;
    }

    public function bootstrap(): void
    {
        $pdo = $this->pdo('postgres');
        $this->verify($pdo, 'postgres');
        $name = $this->manifest['database'];
        if ((int) $pdo->query('SELECT count(*) FROM pg_database WHERE datistemplate = false')->fetchColumn() !== 1) {
            throw new RuntimeException('Refusing a cluster which is not freshly initialized.');
        }
        $pdo->exec('CREATE DATABASE "'.$name.'"');
        $target = $this->pdo($name);
        $this->verify($target, $name);
        $target->exec('CREATE TABLE public.rbms_step4a_guard (nonce text NOT NULL)');
        $statement = $target->prepare('INSERT INTO public.rbms_step4a_guard VALUES (?)');
        $statement->execute([$this->manifest['nonce']]);
    }

    public function connection(): PostgresConnection
    {
        $name = $this->manifest['database'];
        $pdo = $this->pdo($name);
        $this->verify($pdo, $name);
        $nonce = $pdo->query('SELECT nonce FROM public.rbms_step4a_guard')->fetchColumn();
        if (! is_string($nonce) || ! hash_equals($this->manifest['nonce'], $nonce)) {
            throw new RuntimeException('Refusing writes without the disposable database ownership marker.');
        }

        return new PostgresConnection($pdo, $name, '', ['driver' => 'pgsql', 'name' => 'fixture']);
    }

    public function version(): string
    {
        return $this->connection()->selectOne('SELECT version() AS version')->version;
    }

    private function pdo(string $database): PDO
    {
        // All connection inputs are explicit fixture values. Never use DB_* or application config.
        // A nonempty synthetic password avoids libpq consulting inherited password sources;
        // this fresh loopback-only cluster uses trust authentication and has no real credentials.
        return new PDO('pgsql:host=127.0.0.1;port='.$this->manifest['port'].';dbname='.$database.';sslmode=disable;connect_timeout=2;application_name=rbms_step4a',
            'rbms_step4a_fixture', 'unused-disposable-fixture', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    }

    private function verify(PDO $pdo, string $database): void
    {
        $state = $pdo->query("SELECT current_database() AS database, current_setting('data_directory') AS data_directory,
            host(inet_server_addr()) AS address, inet_server_port() AS port, pg_is_in_recovery() AS recovery")->fetch(PDO::FETCH_ASSOC);
        $actual = realpath($state['data_directory']);
        $expected = realpath($this->manifest['data_directory']);
        $checks = ['database' => $state['database'] === $database,
            'data_directory' => $actual !== false && $expected !== false && strcasecmp($actual, $expected) === 0,
            'address' => $state['address'] === '127.0.0.1', 'port' => (int) $state['port'] === $this->manifest['port'],
            'recovery' => in_array($state['recovery'], [false, 'f', 0, '0'], true)];
        if (in_array(false, $checks, true)) {
            throw new RuntimeException('Disposable server identity failed: '.implode(', ', array_keys($checks, false, true)));
        }
    }
}
