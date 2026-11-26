package com.kaxia.cartridge;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * 任天堂家长控制接口的最小客户端。
 *
 * 这是非官方接口，只读取当前登录账号自己的家庭/游玩数据。
 * 所有网络请求都在原生层完成，避免 WebView 的 CORS 问题。
 */
final class NintendoApiClient {

    static final String CLIENT_ID = "54789befb391a838";
    static final String REDIRECT_URI = "npf54789befb391a838://auth";
    static final String AUTHORIZE_URL = "https://accounts.nintendo.com/connect/1.0.0/authorize";
    static final String SESSION_TOKEN_URL = "https://accounts.nintendo.com/connect/1.0.0/api/session_token";
    static final String TOKEN_URL = "https://accounts.nintendo.com/connect/1.0.0/api/token";
    static final String ACCOUNT_URL = "https://api.accounts.nintendo.com/2.0.0/users/me";
    static final String API_BASE = "https://app.lp1.znma.srv.nintendo.net";
    static final String APP_PKG = "com.nintendo.znma";
    // 任天堂会随官方家长控制 App 更新提高接口版本要求。
    // 2.6.0 / 700 在 2026 年 11 月官方 2.7.0 上线后开始返回 HTTP 400 update_required。
    static final String APP_VERSION = "2.7.0";
    static final String APP_BUILD = "740";
    static final String OS_NAME = "ANDROID";
    static final String OS_VERSION = "34";
    static final String DEVICE_MODEL = "Pixel 4 XL";

    static final String[] SCOPES = {
        "openid", "user",
        "moonUser:administration", "moonDevice:create", "moonOwnedDevice:administration",
        "moonParentalControlSetting", "moonParentalControlSetting:update",
        "moonParentalControlSettingState", "moonPairingState", "moonSmartDevice:administration",
        "moonDailySummary", "moonMonthlySummary"
    };

    private static final int TIMEOUT = 25000;

    private NintendoApiClient() {}

    static String createState() {
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        return android.util.Base64.encodeToString(bytes, android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING);
    }

    static String createVerifier() {
        byte[] bytes = new byte[48];
        new SecureRandom().nextBytes(bytes);
        return android.util.Base64.encodeToString(bytes, android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING);
    }

    static String challenge(String verifier) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(verifier.getBytes(StandardCharsets.US_ASCII));
            return android.util.Base64.encodeToString(hash, android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING);
        } catch (Exception error) {
            throw new IllegalStateException("无法生成 PKCE challenge", error);
        }
    }

    static String authorizeUrl(String state, String verifier) {
        try {
            StringBuilder scope = new StringBuilder();
            for (int i = 0; i < SCOPES.length; i++) {
                if (i > 0) scope.append(' ');
                scope.append(SCOPES[i]);
            }
            return AUTHORIZE_URL
                + "?client_id=" + enc(CLIENT_ID)
                + "&redirect_uri=" + enc(REDIRECT_URI)
                + "&response_type=session_token_code"
                + "&scope=" + enc(scope.toString())
                + "&session_token_code_challenge=" + enc(challenge(verifier))
                + "&session_token_code_challenge_method=S256"
                + "&state=" + enc(state)
                + "&theme=login_form";
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

    static JSONObject completeLogin(Context context, String code, String verifier) throws Exception {
        String sessionToken = requestSessionToken(code, verifier);
        JSONObject token = requestToken(sessionToken);
        String accessToken = token.optString("access_token", "");
        if (accessToken.isEmpty()) throw new Exception("任天堂没有返回 access_token");
        JSONObject me = requestJson("GET", ACCOUNT_URL, null, null, "Bearer " + accessToken);
        String id = me.optString("id", "").trim();
        if (id.isEmpty()) throw new Exception("无法读取任天堂账号信息");
        JSONObject account = new JSONObject();
        account.put("id", id);
        account.put("nickname", me.optString("nickname", "任天堂账号"));
        account.put("avatarUrl", me.optString("imageUri", ""));
        account.put("country", me.optString("country", ""));
        account.put("lastSyncAt", 0L);
        account.put("devices", new JSONArray());
        return NintendoStore.saveAccount(context, account, sessionToken);
    }

    static JSONObject sync(Context context, String accountId) throws Exception {
        String sessionToken = NintendoStore.getSessionToken(context, accountId);
        if (sessionToken == null) throw new Exception("授权已失效，请重新登录任天堂账号");
        JSONObject token = requestToken(sessionToken);
        String idToken = token.optString("id_token", "");
        if (idToken.isEmpty()) throw new Exception("任天堂没有返回 id_token");

        JSONArray devices = fetchDevices(idToken);
        if (devices.length() == 0) {
            throw new Exception("这个任天堂账号下没有已绑定的 Switch 主机。请先在 Nintendo Switch Parental Controls App 中绑定主机。");
        }
        List<String> deviceErrors = new ArrayList<>();
        JSONArray records = new JSONArray();
        JSONArray deviceMeta = new JSONArray();
        Map<String, JSONObject> players = new LinkedHashMap<>();
        Set<String> seen = new HashSet<>();
        int totalMinutes = 0;
        String minDate = null;
        String maxDate = null;

        for (int i = 0; i < devices.length(); i++) {
            JSONObject paired = devices.optJSONObject(i);
            if (paired == null) continue;
            String deviceId = paired.optString("deviceId", "");
            if (deviceId.isEmpty()) {
                JSONObject device = paired.optJSONObject("device");
                if (device != null) deviceId = device.optString("id", "");
            }
            if (deviceId.isEmpty()) continue;
            String label = paired.optString("label", "");
            JSONObject device = paired.optJSONObject("device");
            String serialNumber = device != null ? device.optString("serialNumber", "") : "";
            if (label.isEmpty()) label = serialNumber.isEmpty() ? "Nintendo Switch" : serialNumber;

            JSONObject meta = new JSONObject();
            meta.put("deviceId", deviceId);
            meta.put("label", label);
            meta.put("serialNumber", serialNumber);
            deviceMeta.put(meta);

            JSONArray days;
            try {
                days = fetchDailySummaries(idToken, deviceId);
            } catch (Exception dailyError) {
                if (isNotFound(dailyError)) {
                    deviceErrors.add(label);
                    continue;
                }
                throw new Exception("读取主机「" + label + "」的游玩记录失败：" + dailyError.getMessage(), dailyError);
            }
            for (int j = 0; j < days.length(); j++) {
                JSONObject day = days.optJSONObject(j);
                if (day == null) continue;
                String date = day.optString("date", "");
                if (date.isEmpty()) continue;
                if (minDate == null || date.compareTo(minDate) < 0) minDate = date;
                if (maxDate == null || date.compareTo(maxDate) > 0) maxDate = date;

                Map<String, String> titles = new HashMap<>();
                JSONArray aggregateApps = day.optJSONArray("playedApps");
                if (aggregateApps != null) {
                    for (int k = 0; k < aggregateApps.length(); k++) {
                        JSONObject app = aggregateApps.optJSONObject(k);
                        if (app == null) continue;
                        String appId = normalizeAppId(app.optString("applicationId", ""));
                        String title = app.optString("title", "");
                        if (!appId.isEmpty()) titles.put(appId, title);
                    }
                }

                JSONArray devicePlayers = day.optJSONArray("devicePlayers");
                boolean usedPlayers = false;
                if (devicePlayers != null && devicePlayers.length() > 0) {
                    for (int k = 0; k < devicePlayers.length(); k++) {
                        JSONObject player = devicePlayers.optJSONObject(k);
                        if (player == null) continue;
                        JSONArray apps = player.optJSONArray("playedApps");
                        if (apps == null || apps.length() == 0) continue;
                        usedPlayers = true;
                        addPlayerApps(records, players, seen, accountId, deviceId, label, date,
                            player.optString("playerId", ""),
                            player.optString("nickname", "Switch 玩家"),
                            player.optString("imageUri", ""),
                            apps, titles);
                    }
                }
                JSONObject anonymous = day.optJSONObject("anonymousPlayer");
                if (anonymous != null && anonymous.optInt("playingTime", 0) > 0) {
                    JSONArray apps = anonymous.optJSONArray("playedApps");
                    if (apps != null && apps.length() > 0) {
                        usedPlayers = true;
                        addPlayerApps(records, players, seen, accountId, deviceId, label, date,
                            "anonymous", "未识别玩家", "", apps, titles);
                    }
                }
                if (!usedPlayers && aggregateApps != null) {
                    addPlayerApps(records, players, seen, accountId, deviceId, label, date,
                        "device", "主机汇总", "", aggregateApps, titles);
                }
            }
        }

        if (records.length() == 0 && !deviceErrors.isEmpty()) {
            String label = deviceErrors.get(0);
            throw new Exception("任天堂找不到主机「" + label + "」的每日游玩记录（404）。请在官方家长控制 App 中打开这台主机并同步一次，或重新绑定主机后再试。");
        }

        totalMinutes = 0;
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.optJSONObject(i);
            if (record != null) totalMinutes += record.optInt("minutes", 0);
        }

        JSONObject patch = new JSONObject();
        patch.put("devices", deviceMeta);
        patch.put("lastSyncAt", System.currentTimeMillis());
        JSONObject account = NintendoStore.updateAccount(context, accountId, patch);

        JSONObject range = new JSONObject();
        range.put("from", minDate == null ? "" : minDate);
        range.put("to", maxDate == null ? "" : maxDate);

        JSONArray playerArray = new JSONArray();
        for (JSONObject player : players.values()) playerArray.put(player);

        JSONObject result = new JSONObject();
        result.put("account", account);
        result.put("devices", deviceMeta);
        result.put("records", records);
        result.put("players", playerArray);
        result.put("dateRange", range);
        result.put("totalMinutes", totalMinutes);
        result.put("fetchedAt", isoNow());
        return result;
    }

    private static void addPlayerApps(
        JSONArray records,
        Map<String, JSONObject> players,
        Set<String> seen,
        String accountId,
        String deviceId,
        String deviceLabel,
        String date,
        String playerId,
        String playerName,
        String playerAvatar,
        JSONArray apps,
        Map<String, String> titles
    ) throws Exception {
        if (playerId == null || playerId.isEmpty()) playerId = normalizePlayerId(playerName);
        String playerKey = deviceId + "|" + playerId;
        JSONObject player = players.get(playerKey);
        if (player == null) {
            player = new JSONObject();
            player.put("id", playerId);
            player.put("name", playerName);
            player.put("avatarUrl", playerAvatar);
            player.put("deviceId", deviceId);
            player.put("deviceLabel", deviceLabel);
            player.put("minutes", 0);
            players.put(playerKey, player);
        }

        for (int i = 0; i < apps.length(); i++) {
            JSONObject app = apps.optJSONObject(i);
            if (app == null) continue;
            String appId = normalizeAppId(app.optString("applicationId", ""));
            int minutes = Math.max(0, app.optInt("playingTime", 0));
            if (appId.isEmpty() || minutes <= 0) continue;
            String key = deviceId + "|" + date + "|" + playerId + "|" + appId;
            if (seen.contains(key)) continue;
            seen.add(key);

            String title = titles.get(appId);
            if (title == null || title.isEmpty()) title = app.optString("title", appId);

            JSONObject record = new JSONObject();
            record.put("accountId", accountId);
            record.put("deviceId", deviceId);
            record.put("deviceLabel", deviceLabel);
            record.put("date", date);
            record.put("playerId", playerId);
            record.put("playerName", playerName);
            record.put("playerAvatar", playerAvatar);
            record.put("applicationId", appId);
            record.put("title", title);
            record.put("minutes", minutes);
            records.put(record);

            player.put("minutes", player.optInt("minutes", 0) + minutes);
        }
    }

    private static JSONArray fetchDevices(String idToken) throws Exception {
        JSONObject root;
        try {
            root = moonRequest(idToken, "/v2/actions/user/fetchOwnedDevices");
        } catch (Exception error) {
            if (isNotFound(error)) {
                throw new Exception("找不到已绑定的 Switch 主机（404）。请确认登录的是家长账号，并在 Nintendo Switch Parental Controls App 中重新绑定主机。", error);
            }
            throw error;
        }
        JSONArray list = firstArray(root, "ownedDevices", "devices", "items");
        return list == null ? new JSONArray() : list;
    }

    private static JSONArray fetchDailySummaries(String idToken, String deviceId) throws Exception {
        JSONObject root = moonRequest(
            idToken,
            "/v2/actions/playSummary/fetchDailySummaries?deviceId=" + enc(deviceId)
        );
        JSONArray list = firstArray(root, "dailySummaries", "items");
        return list == null ? new JSONArray() : list;
    }

    private static JSONObject moonRequest(String idToken, String path) throws Exception {
        Map<String, String> headers = new HashMap<>();
        String language = Locale.getDefault().toLanguageTag();
        String timeZone = TimeZone.getDefault().getID();
        headers.put("User-Agent", "moon_ANDROID/" + APP_VERSION + " (" + APP_PKG + "; build:" + APP_BUILD + "; " + OS_NAME + " " + OS_VERSION + ")");
        headers.put("X-Moon-App-Id", APP_PKG);
        headers.put("X-Moon-Os", OS_NAME);
        headers.put("X-Moon-Os-Version", OS_VERSION);
        headers.put("X-Moon-Model", DEVICE_MODEL);
        headers.put("X-Moon-App-Display-Version", APP_VERSION);
        headers.put("X-Moon-App-Internal-Version", APP_BUILD);
        headers.put("X-Moon-TimeZone", timeZone);
        headers.put("X-Moon-Os-Language", language);
        headers.put("X-Moon-App-Language", language);
        try {
            return requestJson("GET", API_BASE + path, null, headers, "Bearer " + idToken);
        } catch (Exception error) {
            throw new Exception(error.getMessage() + "  [" + path + "]", error);
        }
    }

    private static boolean isNotFound(Exception error) {
        String message = error == null ? "" : error.getMessage();
        return message != null && (message.contains("HTTP 404") || message.contains("resource_is_not_found"));
    }

    private static String requestSessionToken(String code, String verifier) throws Exception {
        Map<String, String> form = new HashMap<>();
        form.put("client_id", CLIENT_ID);
        form.put("session_token_code", code);
        form.put("session_token_code_verifier", verifier);
        JSONObject response = requestJson("POST", SESSION_TOKEN_URL, formEncode(form), null, null);
        String token = response.optString("session_token", "");
        if (token.isEmpty()) throw new Exception("未能取得任天堂 session_token");
        return token;
    }

    private static JSONObject requestToken(String sessionToken) throws Exception {
        JSONObject body = new JSONObject();
        body.put("client_id", CLIENT_ID);
        body.put("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer-session-token");
        body.put("session_token", sessionToken);
        JSONObject response = requestJson("POST", TOKEN_URL, body.toString(), null, null);
        if (response.optString("id_token", "").isEmpty()) {
            throw new Exception("任天堂授权已失效，请重新登录");
        }
        return response;
    }

    private static JSONObject requestJson(
        String method,
        String url,
        String body,
        Map<String, String> headers,
        String authorization
    ) throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(TIMEOUT);
            connection.setReadTimeout(TIMEOUT);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
            if (authorization != null && !authorization.isEmpty()) {
                connection.setRequestProperty("Authorization", authorization);
            }
            if (headers != null) {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    connection.setRequestProperty(entry.getKey(), entry.getValue());
                }
            }
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", body.trim().startsWith("{") ? "application/json" : "application/x-www-form-urlencoded");
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text = stream == null ? "" : readAll(stream);
            if (status >= 400) {
                String detail = describeError(text);
                if (status == 401 || status == 403) {
                    throw new Exception("任天堂授权已失效，请重新登录（HTTP " + status + "）");
                }
                if (status == 400 && text.contains("update_required")) {
                    throw new Exception("任天堂要求更新家长控制接口版本（当前内置 " + APP_VERSION + " / " + APP_BUILD + "）。请更新卡匣后再试。");
                }
                throw new Exception("任天堂接口返回 HTTP " + status + "：" + detail);
            }
            if (text.isEmpty()) return new JSONObject();
            return new JSONObject(text);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String describeError(String text) {
        String raw = text == null ? "" : text.trim();
        if (raw.isEmpty()) return "没有返回错误内容";
        try {
            JSONObject json = new JSONObject(raw);
            String code = json.optString("errorCode", "");
            String title = json.optString("title", "");
            String detail = json.optString("detail", "");
            String instance = json.optString("instance", "");
            StringBuilder message = new StringBuilder();
            if (!title.isEmpty()) message.append(title);
            if (!code.isEmpty()) {
                if (message.length() > 0) message.append(" / ");
                message.append(code);
            }
            if (!detail.isEmpty()) {
                if (message.length() > 0) message.append("：");
                message.append(detail);
            }
            if (!instance.isEmpty()) {
                if (message.length() > 0) message.append(" [").append(instance).append(']');
            }
            if (message.length() > 0) {
                String result = message.toString();
                return result.length() > 300 ? result.substring(0, 300) : result;
            }
        } catch (Exception ignored) {
            // 非 JSON 错误，保留原始文本的前 240 个字符。
        }
        return raw.length() > 240 ? raw.substring(0, 240) : raw;
    }

    private static String readAll(InputStream stream) throws Exception {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) builder.append(line).append('\n');
            return builder.toString();
        }
    }

    private static String formEncode(Map<String, String> values) throws Exception {
        StringBuilder builder = new StringBuilder();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (builder.length() > 0) builder.append('&');
            builder.append(enc(entry.getKey())).append('=').append(enc(entry.getValue()));
        }
        return builder.toString();
    }

    private static String normalizeAppId(String value) {
        return value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
    }

    private static String normalizePlayerId(String name) {
        if (name == null || name.trim().isEmpty()) return "player";
        return name.trim().toLowerCase(Locale.ROOT).replaceAll("\\s+", "_");
    }

    private static JSONArray firstArray(JSONObject root, String... keys) {
        for (String key : keys) {
            JSONArray value = root.optJSONArray(key);
            if (value != null) return value;
        }
        return findArray(root, keys);
    }

    private static JSONArray findArray(Object node, String... keys) {
        if (node instanceof JSONObject) {
            JSONObject object = (JSONObject) node;
            for (String key : keys) {
                JSONArray value = object.optJSONArray(key);
                if (value != null) return value;
            }
            JSONArray names = object.names();
            if (names != null) {
                for (int i = 0; i < names.length(); i++) {
                    JSONArray found = findArray(object.opt(names.optString(i)), keys);
                    if (found != null) return found;
                }
            }
        } else if (node instanceof JSONArray) {
            JSONArray array = (JSONArray) node;
            for (int i = 0; i < array.length(); i++) {
                JSONArray found = findArray(array.opt(i), keys);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static String enc(String value) throws Exception {
        return URLEncoder.encode(value == null ? "" : value, "UTF-8");
    }

    private static String isoNow() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US);
        return format.format(new Date());
    }
}
