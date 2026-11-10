<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ContactNumberValidationTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_requires_an_eleven_digit_mobile_number_beginning_with_zero_nine(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);

        $payload = [
            'name' => 'Contact Test Guest',
            'email' => 'contact-test@example.test',
            'phone' => '09171234567',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'terms' => true,
            'captcha_token' => 'test-token',
        ];

        foreach (['0917123456', '091712345678', '0917abc4567', '08171234567', '+639171234567'] as $phone) {
            $this->postJson('/api/register', [...$payload, 'phone' => $phone])
                ->assertUnprocessable()
                ->assertJsonValidationErrors('phone');
        }

        $this->assertDatabaseCount('users', 0);

        Http::fake([
            'www.google.com/recaptcha/api/siteverify' => Http::response(['success' => true]),
        ]);

        $this->postJson('/api/register', $payload)
            ->assertCreated()
            ->assertJsonPath('user.email', $payload['email']);

        $this->assertDatabaseHas('users', [
            'email' => $payload['email'],
            'phone' => '09171234567',
        ]);
    }
}
