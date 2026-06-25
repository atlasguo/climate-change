import { initApp } from './app.js';

const root = document.querySelector('#app');

async function bootstrap() {
  try {
    await initApp(root);
  } catch (error) {
    console.error(error);
    root.innerHTML = `
      <section class="app-fallback" role="alert" aria-live="assertive">
        <div class="app-fallback__card">
          <p class="app-fallback__eyebrow">Climate Change Visualized</p>
          <h1 class="app-fallback__title">The dataset failed to load.</h1>
          <p class="app-fallback__body">
            Check that <code>data</code> is present and try again.
          </p>
        </div>
      </section>
    `;
  }
}

bootstrap();
