package com.kaxia.cartridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 任天堂账号的本地存储。
 *
 * 元数据（昵称、头像、设备列表）保存在普通 SharedPreferences；
 * session_token 使用 Android Keystore 里的 AES-GCM 密钥加密后保存。
 * session_token 永远不会返回给 JavaScript。
 */
final class NintendoStore {

    private static final String PREFS = "kaxia_nintendo";
    private static final String ACCOUNT_PREFIX = "account_";
    private static final String TOKEN_PREFIX = "token_";
    private static final String KEY_ALIAS = "kaxia_nintendo_token_key";
    private static final int GCM_TAG_BITS = 128;

    private NintendoStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject saveAccount(Context context, JSONObject account, String sessionToken) throws Exception {
        String id = account.optString("id", "").trim();
        if (id.isEmpty()) throw new Exception("任天堂账号缺少用户 ID");
        JSONObject meta = new JSONObject(account.toString());
        meta.put("id", id);
        JSONObject previous = getAccount(context, id);
        meta.put("addedAt", previous != null ? previous.optLong("addedAt", System.currentTimeMillis()) : System.currentTimeMillis());
        if (!meta.has("lastSyncAt")) meta.put("lastSyncAt", 0L);
        if (!meta.has("devices")) meta.put("devices", new JSONArray());

        SharedPreferences preferences = prefs(context);
        preferences.edit()
            .putString(ACCOUNT_PREFIX + id, meta.toString())
            .putString(TOKEN_PREFIX + id, encrypt(sessionToken))
            .apply();
        return meta;
    }

    static JSONObject getAccount(Context context, String id) {
        String raw = prefs(context).getString(ACCOUNT_PREFIX + id, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception error) {
            return null;
        }
    }

    static JSONArray listAccounts(Context context) {
        SharedPreferences preferences = prefs(context);
        List<JSONObject> accounts = new ArrayList<>();
        for (String key : preferences.getAll().keySet()) {
            if (!key.startsWith(ACCOUNT_PREFIX)) continue;
            String raw = preferences.getString(key, null);
            if (raw == null) continue;
            try {
                accounts.add(new JSONObject(raw));
            } catch (Exception ignored) { }
        }
        Collections.sort(accounts, new Comparator<JSONObject>() {
            @Override
            public int compare(JSONObject a, JSONObject b) {
                return Long.compare(a.optLong("addedAt", 0), b.optLong("addedAt", 0));
            }
        });
        JSONArray result = new JSONArray();
        for (JSONObject account : accounts) result.put(account);
        return result;
    }

    static JSONObject updateAccount(Context context, String id, JSONObject patch) throws Exception {
        JSONObject existing = getAccount(context, id);
        if (existing == null) throw new Exception("找不到这个任天堂账号");
        JSONObject merged = new JSONObject(existing.toString());
        JSONArray names = patch.names();
        if (names != null) {
            for (int i = 0; i < names.length(); i++) {
                String key = names.optString(i);
                merged.put(key, patch.opt(key));
            }
        }
        prefs(context).edit().putString(ACCOUNT_PREFIX + id, merged.toString()).apply();
        return merged;
    }

    static String getSessionToken(Context context, String id) {
        String encrypted = prefs(context).getString(TOKEN_PREFIX + id, null);
        if (encrypted == null) return null;
        try {
            return decrypt(encrypted);
        } catch (Exception error) {
            return null;
        }
    }

    static void removeAccount(Context context, String id) {
        SharedPreferences preferences = prefs(context);
        SharedPreferences.Editor editor = preferences.edit()
            .remove(ACCOUNT_PREFIX + id)
            .remove(TOKEN_PREFIX + id);
        editor.apply();
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
            generator.generateKey();
        }
        return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
    }

    private static String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] combined = new byte[iv.length + encrypted.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
        return Base64.encodeToString(combined, Base64.NO_WRAP);
    }

    private static String decrypt(String value) throws Exception {
        byte[] combined = Base64.decode(value, Base64.NO_WRAP);
        byte[] iv = new byte[12];
        byte[] encrypted = new byte[combined.length - 12];
        System.arraycopy(combined, 0, iv, 0, 12);
        System.arraycopy(combined, 12, encrypted, 0, encrypted.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }
}
