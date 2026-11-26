package com.kaxia.cartridge;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;

/**
 * 在 App 内打开任天堂官方登录页。
 * 登录成功后拦截 npf54789befb391a838://auth 回调，换成 session_token 并加密保存。
 * 密码只输入在任天堂页面里，App 不读取、不保存。
 */
public class NintendoAuthActivity extends AppCompatActivity {

    private static final String CALLBACK = "npf54789befb391a838://auth";
    private WebView webView;
    private ProgressBar progressBar;
    private String verifier;
    private String state;
    private boolean finished;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        verifier = NintendoApiClient.createVerifier();
        state = NintendoApiClient.createState();
        setContentView(buildLayout());
        configureWebView();
        webView.loadUrl(NintendoApiClient.authorizeUrl(state, verifier));
    }

    private View buildLayout() {
        int cream = Color.rgb(244, 240, 231);
        int ink = Color.rgb(27, 26, 23);
        int line = Color.rgb(229, 222, 207);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(cream);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(18), dp(10), dp(10), dp(10));
        bar.setBackgroundColor(cream);

        TextView title = new TextView(this);
        title.setText("登录任天堂账号");
        title.setTextColor(ink);
        title.setTextSize(18);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, dp(44), 1f);
        bar.addView(title, titleParams);

        TextView close = new TextView(this);
        close.setText("关闭");
        close.setTextColor(Color.rgb(120, 112, 100));
        close.setTextSize(14);
        close.setGravity(Gravity.CENTER);
        close.setPadding(dp(12), dp(8), dp(12), dp(8));
        close.setOnClickListener(v -> cancel());
        bar.addView(close);
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        View divider = new View(this);
        divider.setBackgroundColor(line);
        root.addView(divider, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        root.addView(progressBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        webView = new WebView(this);
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return root;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(
            "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
        );

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (!finished && failingUrl != null && failingUrl.startsWith("http")) {
                    Toast.makeText(NintendoAuthActivity.this, "登录页加载失败：" + description, Toast.LENGTH_LONG).show();
                }
            }
        });
    }

    private boolean handleUrl(String url) {
        if (url == null || !url.startsWith(CALLBACK)) return false;
        if (finished) return true;
        Uri uri = Uri.parse(url);
        Map<String, String> params = parseParams(uri.getFragment());
        if (params.isEmpty()) params = parseParams(uri.getQuery());

        String error = params.get("error");
        if (error != null) {
            fail("任天堂登录失败：" + error);
            return true;
        }
        String returnedState = params.get("state");
        if (returnedState == null || !returnedState.equals(state)) {
            fail("登录状态校验失败，请重试");
            return true;
        }
        String code = params.get("session_token_code");
        if (code == null || code.isEmpty()) {
            fail("没有拿到任天堂授权码，请重试");
            return true;
        }

        progressBar.setVisibility(View.VISIBLE);
        progressBar.setIndeterminate(true);
        webView.setVisibility(View.INVISIBLE);
        new Thread(() -> {
            try {
                JSONObject account = NintendoApiClient.completeLogin(NintendoAuthActivity.this, code, verifier);
                runOnUiThread(() -> success(account));
            } catch (Exception errorObject) {
                runOnUiThread(() -> fail(errorObject.getMessage() == null ? "任天堂登录失败" : errorObject.getMessage()));
            }
        }).start();
        return true;
    }

    private void success(JSONObject account) {
        if (finished) return;
        finished = true;
        Intent result = new Intent();
        result.putExtra("account", account.toString());
        setResult(RESULT_OK, result);
        finish();
    }

    private void fail(String message) {
        if (finished) return;
        finished = true;
        Intent result = new Intent();
        result.putExtra("error", message == null ? "任天堂登录失败" : message);
        setResult(RESULT_CANCELED, result);
        finish();
    }

    private void cancel() {
        if (finished) return;
        finished = true;
        setResult(RESULT_CANCELED);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        cancel();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private static Map<String, String> parseParams(String raw) {
        Map<String, String> params = new HashMap<>();
        if (raw == null || raw.isEmpty()) return params;
        for (String part : raw.split("&")) {
            int index = part.indexOf('=');
            if (index <= 0) continue;
            try {
                String key = URLDecoder.decode(part.substring(0, index), "UTF-8");
                String value = URLDecoder.decode(part.substring(index + 1), "UTF-8");
                params.put(key, value);
            } catch (Exception ignored) { }
        }
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
