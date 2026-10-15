// Google Analytics (Firebase) do Preço de Cana
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAnalytics, logEvent, isSupported } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB2YhiOEGiKIzrxukouKn9vK2dKt75YF2Y',
  authDomain: 'campo-5b2a5.firebaseapp.com',
  databaseURL: 'https://campo-5b2a5-default-rtdb.firebaseio.com',
  projectId: 'campo-5b2a5',
  storageBucket: 'campo-5b2a5.firebasestorage.app',
  messagingSenderId: '596202438849',
  appId: '1:596202438849:web:af6a7414855bd5c9f91440',
  measurementId: 'G-M77LHGCK0M'
};

const fila = window.__eventosPendentes || [];

try {
  if (await isSupported()) {
    const analytics = getAnalytics(initializeApp(firebaseConfig));
    const instalado = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    window.registrarEvento = (nome, params = {}) => {
      try { logEvent(analytics, nome, { modo: instalado ? 'app_instalado' : 'navegador', ...params }); } catch (e) { /* ignora */ }
    };
    // eventos que aconteceram antes do Analytics carregar
    fila.forEach(([nome, params]) => window.registrarEvento(nome, params));
  }
} catch (e) {
  console.warn('Analytics não carregou:', e);
}
