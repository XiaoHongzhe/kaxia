package com.kaxia.cartridge;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * 局域网数据同步。
 *
 * App 通过 UDP 广播寻找电脑端卡匣服务，找到后只向该电脑的
 * /api/sync 上传或下载 JSON；不经过云端。
 */
@CapacitorPlugin(name = "LanSync")
public class LanSyncPlugin extends Plugin {

    private static final String DISCOVER_MESSAGE = "KAXIA_DISCOVER_V1";
    private static final int DISCOVERY_PORT = 8766;
    private static final int TIMEOUT_MS = 30000;

    @PluginMethod
    public void discover(PluginCall call) {
        new Thread(() -> {
            DatagramSocket socket = null;
            try {
                int port = call.getInt("port", DISCOVERY_PORT);
                socket = new DatagramSocket();
                socket.setBroadcast(true);
                socket.setSoTimeout(700);
                byte[] request = DISCOVER_MESSAGE.getBytes(StandardCharsets.UTF_8);

                Set<String> targets = new HashSet<>();
                targets.add("255.255.255.255");
                for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!network.isUp() || network.isLoopback()) continue;
                    for (InterfaceAddress address : network.getInterfaceAddresses()) {
                        InetAddress broadcast = address.getBroadcast();
                        if (broadcast != null) targets.add(broadcast.getHostAddress());
                    }
                }
                for (String target : targets) {
                    try {
                        InetAddress address = InetAddress.getByName(target);
                        socket.send(new DatagramPacket(request, request.length, address, port));
                    } catch (Exception ignored) {
                        // 某个网卡不允许广播时继续尝试其他网卡。
                    }
                }

                JSArray servers = new JSArray();
                Set<String> seen = new HashSet<>();
                long deadline = System.currentTimeMillis() + 2400;
                byte[] buffer = new byte[4096];
                while (System.currentTimeMillis() < deadline) {
                    try {
                        DatagramPacket response = new DatagramPacket(buffer, buffer.length);
                        socket.receive(response);
                        String text = new String(response.getData(), 0, response.getLength(), StandardCharsets.UTF_8);
                        JSONObject data = new JSONObject(text);
                        if (!"kaxia-sync".equals(data.optString("service", ""))) continue;
                        String url = data.optString("url", "");
                        if (url.isEmpty() || !seen.add(url)) continue;
                        JSObject server = new JSObject();
                        server.put("name", data.optString("name", "卡匣电脑"));
                        server.put("url", url);
                        server.put("token", data.optString("token", ""));
                        server.put("port", data.optInt("port", port));
                        servers.put(server);
                        if (servers.length() >= 10) break;
                    } catch (SocketTimeoutException ignored) {
                        // 继续等到总超时。
                    }
                }
                socket.close();
                socket = null;
                JSObject result = new JSObject();
                result.put("servers", servers);
                call.resolve(result);
            } catch (Exception error) {
                if (socket != null) socket.close();
                call.reject(error.getMessage() == null ? "没有找到电脑端卡匣服务" : error.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        String serverUrl = call.getString("serverUrl", "");
        if (serverUrl.isEmpty()) {
            call.reject("缺少电脑地址");
            return;
        }
        new Thread(() -> {
            try {
                HttpURLConnection connection = open(serverUrl, "/api/app/info", "", "GET");
                int status = connection.getResponseCode();
                String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
                connection.disconnect();
                if (status < 200 || status >= 300) {
                    call.reject(errorText(text, status));
                    return;
                }
                call.resolve(new JSObject(text));
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "检查更新失败" : error.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("缺少下载地址");
            return;
        }
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            call.reject("下载地址无效");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("没有可用的浏览器");
        }
    }

    @PluginMethod
    public void upload(PluginCall call) {
        String serverUrl = call.getString("serverUrl", "");
        String token = call.getString("token", "");
        String payload = call.getString("payload", "");
        if (serverUrl.isEmpty() || payload.isEmpty()) {
            call.reject("缺少同步地址或数据");
            return;
        }
        new Thread(() -> {
            try {
                HttpURLConnection connection = open(serverUrl, "/api/sync", token, "POST");
                byte[] body = payload.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }
                int status = connection.getResponseCode();
                String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
                connection.disconnect();
                if (status < 200 || status >= 300) {
                    call.reject(errorText(text, status));
                    return;
                }
                call.resolve(new JSObject(text.isEmpty() ? "{}" : text));
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "上传失败" : error.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void download(PluginCall call) {
        String serverUrl = call.getString("serverUrl", "");
        String token = call.getString("token", "");
        if (serverUrl.isEmpty()) {
            call.reject("缺少同步地址");
            return;
        }
        new Thread(() -> {
            try {
                HttpURLConnection connection = open(serverUrl, "/api/sync", token, "GET");
                int status = connection.getResponseCode();
                String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
                connection.disconnect();
                if (status < 200 || status >= 300) {
                    call.reject(errorText(text, status));
                    return;
                }
                JSObject result = new JSObject();
                result.put("payload", text);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "下载失败" : error.getMessage());
            }
        }).start();
    }

    private HttpURLConnection open(String serverUrl, String path, String token, String method) throws Exception {
        String base = serverUrl.endsWith("/") ? serverUrl.substring(0, serverUrl.length() - 1) : serverUrl;
        HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(TIMEOUT_MS);
        connection.setReadTimeout(TIMEOUT_MS);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("X-Kaxia-Token", token == null ? "" : token);
        if ("POST".equals(method)) {
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        }
        return connection;
    }

    private String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        try (BufferedInputStream input = new BufferedInputStream(stream);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private String errorText(String text, int status) {
        try {
            JSONObject json = new JSONObject(text);
            String message = json.optString("error", "");
            if (!message.isEmpty()) return message;
        } catch (Exception ignored) {
            // 保留 HTTP 状态。
        }
        return "HTTP " + status;
    }
}
