import type { CapacitorConfig } from '@capacitor/cli';

// Scaffolding per il wrapping iOS nativo (Fase futura, richiede Mac + Xcode).
// Vedi SETUP.md § 8. Aggiorna appId con il tuo bundle identifier.
const config: CapacitorConfig = {
  appId: 'com.tuonome.smartfinance',
  appName: 'Smart Finance',
  webDir: '.',
  ios: {
    contentInset: 'always',
    backgroundColor: '#0c0c0e'
  },
  server: {
    // In sviluppo si può puntare al dev server; in produzione si usano i file impacchettati.
    iosScheme: 'https'
  }
};

export default config;
