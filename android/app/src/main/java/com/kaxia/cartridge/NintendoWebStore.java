package com.kaxia.cartridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Locale;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 任天堂网页登录状态的本地存储。
 *
 * 每个任天堂账号有独立的 Cookie 快照。快照使用 Android Keystore 里的
 * AES-GCM 密钥加密后保存，明文 Cookie 不写入 SharedPreferences。
 */
final class NintendoWebStore {

    private static final String PREFS = "kaxia_nintendo_web";
    private static final String KEY_PREFIX = "profile_";
    private static final String KEY_ALIAS = "kaxia_nintendo_web_cookie_key";
    private static final int GCM_TAG_BITS = 128;

    private NintendoWebStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject load(Context context, String accountId) {
        if (accountId == null || accountId.isEmpty()) return null;
        String raw = prefs(context).getString(KEY_PREFIX + keyHash(accountId), null);
        if (raw == null) return null;
        try {
            return new JSONObject(decrypt(raw));
        } catch (Exception error) {
            prefs(context).edit().remove(KEY_PREFIX + keyHash(accountId)).apply();
            return null;
        }
    }

    static void save(Context context, String accountId, JSONObject profile) {
        if (accountId == null || accountId.isEmpty() || profile == null) return;
        try {
            prefs(context).edit()
                .putString(KEY_PREFIX + keyHash(accountId), encrypt(profile.toString()))
                .apply();
        } catch (Exception ignored) {
            // 加密失败时不写入，宁可下次重新登录。
        }
    }

    static void remove(Context context, String accountId) {
        if (accountId == null || accountId.isEmpty()) return;
        prefs(context).edit().remove(KEY_PREFIX + keyHash(accountId)).apply();
    }

    private static String keyHash(String accountId) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(accountId.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            for (byte value : hash) builder.append(String.format(Locale.ROOT, "%02x", value));
            return builder.toString();
        } catch (Exception error) {
            return Integer.toHexString(accountId.hashCode());
        }
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
