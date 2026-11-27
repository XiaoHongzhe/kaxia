package com.kaxia.cartridge;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NintendoPlugin.class);
        registerPlugin(NintendoWebPlugin.class);
        registerPlugin(RegionScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
