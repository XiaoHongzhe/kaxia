package com.kaxia.cartridge;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * App 内的任天堂网页浏览器。
 *
 * 安全约束：
 * - 只允许 https 的任天堂官方域名，外部链接直接拦截；
 * - 不注入 JavaScript 桥，不读取登录表单，不保存密码；
 * - WebView 关闭文件访问、内容访问、混合内容和调试；
 * - 账号 Cookie 快照使用 Android Keystore AES-GCM 加密保存；
 * - 切换账号时清空 Cookie、WebStorage 和页面缓存，避免串号。
 */
public class NintendoWebActivity extends AppCompatActivity {

    private static final String DEFAULT_URL = "https://accounts.nintendo.com/";
    private static final String[] COOKIE_URLS = {
        "https://accounts.nintendo.com",
        "https://www.nintendo.com",
        "https://ec.nintendo.com",
        "https://my.nintendo.com",
        "https://store.nintendo.com",
        "https://store-jp.nintendo.com",
        "https://store.nintendo.com.hk",
        "https://store.nintendo.com.tw",
        "https://store.nintendo.co.kr",
        "https://store.nintendo.co.uk"
    };
    private static final String[] ALLOWED_DOMAINS = {
        "nintendo.com",
        "nintendo.co.jp",
        "nintendo.com.hk",
        "nintendo.com.tw",
        "nintendo.co.kr",
        "nintendo.co.uk",
        "nintendo.com.au",
        "nintendo-europe.com",
        "nintendo.jp",
        "nintendo.net"
    };

    private WebView webView;
    private ProgressBar progressBar;
    private TextView accountView;
    private TextView statusView;
    private CookieManager cookieManager;
    private JSONArray accounts = new JSONArray();
    private String currentAccountId = "";
    private String startUrl = DEFAULT_URL;
    private boolean switching = false;
    private boolean destroyed = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);

        String requestedUrl = getIntent().getStringExtra("url");
        startUrl = isAllowedUrl(requestedUrl) ? requestedUrl : DEFAULT_URL;
        String requestedAccount = getIntent().getStringExtra("accountId");

        setContentView(buildLayout());
        configureWebView();

        accounts = NintendoStore.listAccounts(this);
        currentAccountId = "";
        if (requestedAccount != null && !requestedAccount.isEmpty() && findAccount(requestedAccount) != null) {
            currentAccountId = requestedAccount;
        } else if (accounts.length() > 0) {
            JSONObject first = accounts.optJSONObject(0);
            if (first != null) currentAccountId = first.optString("id", "");
        }
        updateAccountUI();
        switchToProfile(currentAccountId, startUrl);
    }

    private View buildLayout() {
        int cream = Color.rgb(244, 240, 231);
        int ink = Color.rgb(27, 26, 23);
        int muted = Color.rgb(120, 112, 100);
        int line = Color.rgb(229, 222, 207);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(cream);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(10), dp(8), dp(12), dp(8));
        bar.setBackgroundColor(cream);

        TextView back = new TextView(this);
        back.setText("‹");
        back.setTextColor(ink);
        back.setTextSize(30);
        back.setGravity(Gravity.CENTER);
        back.setContentDescription("返回");
        back.setOnClickListener(v -> goBackOrFinish());
        bar.addView(back, new LinearLayout.LayoutParams(dp(42), dp(44)));

        TextView title = new TextView(this);
        title.setText("任天堂");
        title.setTextColor(ink);
        title.setTextSize(17);
        title.setTypeface(null, Typeface.BOLD);
        bar.addView(title, new LinearLayout.LayoutParams(0, dp(44), 1f));

        accountView = new TextView(this);
        accountView.setTextColor(ink);
        accountView.setTextSize(12);
        accountView.setGravity(Gravity.CENTER);
        accountView.setPadding(dp(10), dp(7), dp(10), dp(7));
        accountView.setBackgroundColor(Color.rgb(235, 229, 216));
        accountView.setOnClickListener(v -> showAccountPicker());
        bar.addView(accountView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)));

        TextView switchButton = new TextView(this);
        switchButton.setText("切换");
        switchButton.setTextColor(muted);
        switchButton.setTextSize(12);
        switchButton.setGravity(Gravity.CENTER);
        switchButton.setPadding(dp(10), dp(7), dp(4), dp(7));
        switchButton.setOnClickListener(v -> showAccountPicker());
        bar.addView(switchButton, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(34)));

        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        statusView = new TextView(this);
        statusView.setTextColor(muted);
        statusView.setTextSize(10);
        statusView.setPadding(dp(16), 0, dp(16), dp(7));
        root.addView(statusView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        View divider = new View(this);
        divider.setBackgroundColor(line);
        root.addView(divider, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        root.addView(progressBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2)));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return root;
    }

    @SuppressLint({"SetJavaScriptEnabled", "DeprecatedApi"})
    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(false);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSaveFormData(false);
        settings.setSavePassword(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, false);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUri(request == null ? null : request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUri(url == null ? null : Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
                progressBar.setProgress(0);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }
        });
    }

    private boolean handleUri(Uri uri) {
        if (uri == null) return true;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if ("http".equals(scheme) || "https".equals(scheme)) {
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            if ("https".equals(scheme) && isAllowedHost(host)) return false;
            toast("只允许访问任天堂官方 HTTPS 页面");
            return true;
        }
        toast("已拦截外部链接");
        return true;
    }

    private boolean isAllowedUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        try {
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            return "https".equals(scheme) && isAllowedHost(host);
        } catch (Exception error) {
            return false;
        }
    }

    private boolean isAllowedHost(String host) {
        if (host == null || host.isEmpty()) return false;
        for (String domain : ALLOWED_DOMAINS) {
            if (host.equals(domain) || host.endsWith("." + domain)) return true;
        }
        return false;
    }

    private JSONObject findAccount(String accountId) {
        if (accountId == null || accountId.isEmpty()) return null;
        for (int i = 0; i < accounts.length(); i++) {
            JSONObject account = accounts.optJSONObject(i);
            if (account != null && accountId.equals(account.optString("id", ""))) return account;
        }
        return null;
    }

    private void updateAccountUI() {
        JSONObject account = findAccount(currentAccountId);
        String name = account != null ? account.optString("nickname", "任天堂账号") : "游客";
        accountView.setText(name + " ▾");
        statusView.setText(account != null
            ? "独立网页登录 · 不保存密码 · 切换时清除跨账号数据"
            : "游客模式 · 不会保存网页登录状态");
    }

    private void switchToProfile(String accountId, String url) {
        if (switching || destroyed) return;
        switching = true;
        saveCurrentCookies();
        currentAccountId = accountId == null ? "" : accountId;
        updateAccountUI();
        final String target = isAllowedUrl(url) ? url : DEFAULT_URL;
        cookieManager.removeAllCookies(value -> runOnUiThread(() -> {
            if (destroyed) return;
            webView.clearCache(true);
            webView.clearFormData();
            webView.clearHistory();
            clearNintendoWebStorage(() -> {
                if (destroyed) return;
                restoreCookies(currentAccountId);
                webView.loadUrl(target);
                switching = false;
            });
        }));
    }

    /** 只清理任天堂域名的 WebStorage，避免影响卡匣自身的本地数据。 */
    private void clearNintendoWebStorage(Runnable after) {
        WebStorage.getInstance().getOrigins(origins -> {
            if (origins != null) {
                for (Object rawOrigin : origins.keySet()) {
                    String origin = String.valueOf(rawOrigin);
                    if (!isAllowedOrigin(origin)) continue;
                    WebStorage.getInstance().deleteOrigin(origin);
                }
            }
            runOnUiThread(() -> {
                if (after != null) after.run();
            });
        });
    }

    private boolean isAllowedOrigin(String origin) {
        try {
            Uri uri = Uri.parse(origin);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            return isAllowedHost(host);
        } catch (Exception error) {
            return false;
        }
    }

    private void saveCurrentCookies() {
        if (currentAccountId == null || currentAccountId.isEmpty() || cookieManager == null) return;
        try {
            cookieManager.flush();
            JSONObject cookies = new JSONObject();
            for (String url : COOKIE_URLS) {
                String value = cookieManager.getCookie(url);
                if (value != null && !value.isEmpty()) cookies.put(url, value);
            }
            JSONObject profile = new JSONObject();
            profile.put("cookies", cookies);
            profile.put("savedAt", System.currentTimeMillis());
            NintendoWebStore.save(this, currentAccountId, profile);
        } catch (Exception ignored) {
            // 保存失败时保留内存中的登录状态，下次切换再试。
        }
    }

    private void restoreCookies(String accountId) {
        if (cookieManager == null) return;
        if (accountId == null || accountId.isEmpty()) {
            cookieManager.flush();
            return;
        }
        JSONObject profile = NintendoWebStore.load(this, accountId);
        JSONObject cookies = profile == null ? null : profile.optJSONObject("cookies");
        if (cookies != null) {
            for (String url : COOKIE_URLS) {
                String raw = cookies.optString(url, "");
                if (raw.isEmpty()) continue;
                for (String part : raw.split(";")) {
                    String cookie = part.trim();
                    if (cookie.isEmpty() || !cookie.contains("=")) continue;
                    cookieManager.setCookie(url, cookie + "; Path=/; Secure");
                }
            }
        }
        cookieManager.flush();
    }

    private void showAccountPicker() {
        final List<String> labels = new ArrayList<>();
        final List<String> ids = new ArrayList<>();
        for (int i = 0; i < accounts.length(); i++) {
            JSONObject account = accounts.optJSONObject(i);
            if (account == null) continue;
            String id = account.optString("id", "");
            String name = account.optString("nickname", "任天堂账号");
            String country = account.optString("country", "");
            labels.add(name + (country.isEmpty() ? "" : " · " + country) + (id.equals(currentAccountId) ? "（当前）" : ""));
            ids.add(id);
        }
        labels.add("游客（不保存登录）");
        ids.add("");
        labels.add("清除当前账号的网页登录");
        ids.add("__clear__");

        new AlertDialog.Builder(this)
            .setTitle("切换任天堂账号")
            .setItems(labels.toArray(new String[0]), (dialog, which) -> {
                String selected = ids.get(which);
                if ("__clear__".equals(selected)) {
                    clearCurrentProfile();
                } else {
                    switchToProfile(selected, startUrl);
                }
            })
            .setNegativeButton("取消", null)
            .show();
    }

    private void clearCurrentProfile() {
        if (currentAccountId == null || currentAccountId.isEmpty()) {
            toast("当前是游客模式，没有可清除的登录");
            return;
        }
        NintendoWebStore.remove(this, currentAccountId);
        currentAccountId = "";
        switchToProfile("", startUrl);
        toast("已清除当前账号的网页登录");
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void goBackOrFinish() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        finish();
    }

    @Override
    public void onBackPressed() {
        goBackOrFinish();
    }

    @Override
    protected void onPause() {
        saveCurrentCookies();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        saveCurrentCookies();
        if (cookieManager != null) {
            // 离开页面后不在 WebView 的明文 Cookie 罐里保留登录态；下次从加密快照恢复。
            cookieManager.removeAllCookies(null);
        }
        clearNintendoWebStorage(null);
        if (webView != null) {
            webView.stopLoading();
            webView.clearCache(true);
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
