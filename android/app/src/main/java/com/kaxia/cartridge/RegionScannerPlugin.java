package com.kaxia.cartridge;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/**
 * 用 ML Kit 在设备上识别卡带盒/标签上的拉丁文字。
 * 返回文字后，由 JS 用 EUR / USA / TWN 等地区码判断版本。
 * 图片不离开手机。
 */
@CapacitorPlugin(name = "RegionScanner")
public class RegionScannerPlugin extends Plugin {

    @PluginMethod
    public void scan(PluginCall call) {
        String image = call.getString("image");
        if (image == null || image.isEmpty()) {
            call.reject("缺少图片");
            return;
        }
        new Thread(() -> {
            TextRecognizer recognizer = null;
            Bitmap bitmap = null;
            try {
                String base64 = image;
                int comma = image.indexOf(',');
                if (comma >= 0) base64 = image.substring(comma + 1);
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bitmap == null) throw new Exception("无法解析图片");
                final Bitmap finalBitmap = bitmap;
                final TextRecognizer finalRecognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                recognizer = finalRecognizer;
                InputImage input = InputImage.fromBitmap(finalBitmap, 0);
                finalRecognizer.process(input)
                    .addOnSuccessListener((Text text) -> {
                        JSObject result = new JSObject();
                        result.put("text", text.getText());
                        JSArray lines = new JSArray();
                        for (Text.TextBlock block : text.getTextBlocks()) {
                            for (Text.Line line : block.getLines()) {
                                lines.put(line.getText());
                            }
                        }
                        result.put("lines", lines);
                        call.resolve(result);
                        finalRecognizer.close();
                        finalBitmap.recycle();
                    })
                    .addOnFailureListener((Exception error) -> {
                        call.reject(error.getMessage() == null ? "文字识别失败" : error.getMessage());
                        finalRecognizer.close();
                        finalBitmap.recycle();
                    });
            } catch (Exception error) {
                if (recognizer != null) recognizer.close();
                if (bitmap != null) bitmap.recycle();
                call.reject(error.getMessage() == null ? "图片识别失败" : error.getMessage());
            }
        }).start();
    }
}
