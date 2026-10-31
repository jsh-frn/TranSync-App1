<?php
// PayMongo redirects here after GCash/Maya payment.
// This page immediately deep-links back into the TranSync app.
$status = htmlspecialchars($_GET['status'] ?? 'failed', ENT_QUOTES, 'UTF-8');
header('Content-Type: text/html; charset=UTF-8');
?>
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Payment <?= $status === 'success' ? 'Successful' : 'Failed' ?></title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f9fafb;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 24px;
    }
    .card {
      background: #fff; border-radius: 20px; padding: 40px 32px;
      text-align: center; max-width: 320px; width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .icon { font-size: 56px; margin-bottom: 16px; }
    h2 { font-size: 20px; font-weight: 800; color: #1a4a52; margin-bottom: 8px; }
    p  { font-size: 14px; color: #6b7280; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon"><?= $status === 'success' ? '✅' : '❌' ?></div>
    <h2><?= $status === 'success' ? 'Payment Successful' : 'Payment Failed' ?></h2>
    <p>Returning you to TranSync...</p>
  </div>
  <script>
    // Redirect back into the app via deep link.
    // openAuthSessionAsync (expo-web-browser) intercepts this and closes the browser.
    window.location.replace('transyncmobile://wallet/topup?status=<?= $status ?>');
  </script>
</body>
</html>
