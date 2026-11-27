package com.kaxia.cartridge;

import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 卡匣的原生任天堂账号桥接。
 *
 * 登录、令牌存储和所有 HTTP 请求都在原生层完成；
 * JavaScript 只能拿到账号元数据、设备和游玩记录，拿不到 session_token。
 */
@CapacitorPlugin(name = "Nintendo")
public class NintendoPlugin extends Plugin {

    @PluginMethod
    public void listAccounts(PluginCall call) {
        try {
            JSONArray accounts = NintendoStore.listAccounts(getContext());
            JSArray result = new JSArray();
            for (int i = 0; i < accounts.length(); i++) {
                result.put(new JSObject(accounts.getJSONObject(i).toString()));
            }
            call.resolve(new JSObject().put("accounts", result));
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "无法读取任天堂账号" : error.getMessage());
        }
    }

    @PluginMethod
    public void addAccount(PluginCall call) {
        Intent intent = new Intent(getContext(), NintendoAuthActivity.class);
        startActivityForResult(call, intent, "addAccountResult");
    }

    @ActivityCallback
    private void addAccountResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK) {
            Intent data = result.getData();
            String message = data != null ? data.getStringExtra("error") : null;
            call.reject(message == null || message.isEmpty() ? "已取消任天堂登录" : message);
            return;
        }
        Intent data = result.getData();
        String raw = data != null ? data.getStringExtra("account") : null;
        if (raw == null || raw.isEmpty()) {
            call.reject("任天堂登录没有返回账号");
            return;
        }
        try {
            call.resolve(new JSObject(raw));
        } catch (Exception error) {
            call.reject("无法解析任天堂账号信息");
        }
    }

    @PluginMethod
    public void removeAccount(PluginCall call) {
        String id = call.getString("accountId");
        if (id == null || id.isEmpty()) {
            call.reject("缺少 accountId");
            return;
        }
        NintendoStore.removeAccount(getContext(), id);
        NintendoWebStore.remove(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void sync(PluginCall call) {
        String id = call.getString("accountId");
        if (id == null || id.isEmpty()) {
            call.reject("缺少 accountId");
            return;
        }
        new Thread(() -> {
            try {
                JSONObject result = NintendoApiClient.sync(getContext(), id);
                call.resolve(new JSObject(result.toString()));
            } catch (Exception error) {
                String message = error.getMessage() == null ? "任天堂同步失败" : error.getMessage();
                call.reject(message);
            }
        }).start();
    }
}
