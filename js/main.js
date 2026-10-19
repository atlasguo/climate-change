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
          <h1 class="app-fallback__title">The visualization failed to load.</h1>
          <p class="app-fallback__body">
            Please reload the page. If the problem persists, the data files may be missing or your browser may be out of date.
          </p>
          <p class="app-fallback__body app-fallback__detail"></p>
        </div>
      </section>
    `;
    const detail = root.querySelector('.app-fallback__detail');
    if (detail && error instanceof Error) {
      detail.textContent = error.message;
    }
  }
}

bootstrap();
