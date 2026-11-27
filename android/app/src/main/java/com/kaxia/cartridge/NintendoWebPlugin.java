package com.kaxia.cartridge;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 打开 App 内的任天堂官方网页。
 *
 * JavaScript 只传账号 ID 和目标 URL；Cookie 和登录状态完全留在原生层。
 */
@CapacitorPlugin(name = "NintendoWeb")
public class NintendoWebPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String accountId = call.getString("accountId", "");
        String url = call.getString("url", "https://accounts.nintendo.com/");
        Intent intent = new Intent(getContext(), NintendoWebActivity.class);
        intent.putExtra("accountId", accountId == null ? "" : accountId);
        intent.putExtra("url", url == null ? "https://accounts.nintendo.com/" : url);
        getActivity().startActivity(intent);
        call.resolve(new JSObject());
    }
}
