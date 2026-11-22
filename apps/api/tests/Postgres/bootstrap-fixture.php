<?php

declare(strict_types=1);

require dirname(__DIR__, 2).'/vendor/autoload.php';

use Tests\Support\DisposablePostgresCluster;

$cluster = new DisposablePostgresCluster;
$cluster->bootstrap();
echo 'Verified and initialized a new disposable PostgreSQL fixture database.'.PHP_EOL;
echo $cluster->version().PHP_EOL;
