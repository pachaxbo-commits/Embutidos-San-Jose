// Runs before the application module, including when its own preload fails.
(() => {
  const isResourceError = error => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk .+ failed/i.test(String(error?.message || error || ''));
  function showRecovery(error) {
    if (!isResourceError(error) || document.getElementById('resource-recovery-notice')) return;
    const notice = document.createElement('aside');
    notice.id = 'resource-recovery-notice';
    notice.setAttribute('role', 'alert');
    Object.assign(notice.style, {position:'fixed', zIndex:'2147483647', bottom:'calc(80px + env(safe-area-inset-bottom, 0px))', left:'12px', right:'12px', maxWidth:'560px', margin:'auto', padding:'16px', border:'1px solid #d97706', borderRadius:'16px', background:'#fffbeb', color:'#78350f', boxShadow:'0 4px 20px #0003', font:'14px/1.5 system-ui', maxHeight:'65vh', overflowY:'auto'});
    const title = document.createElement('strong');
    title.textContent = 'No se pudo cargar una parte de la aplicación';
    const detail = document.createElement('p');
    detail.textContent = 'Puede haber una versión nueva o un problema de conexión. Esta pantalla y los datos que estás escribiendo se conservan. Abre la versión actual en otra pestaña para volver a generar el documento.';
    const link = document.createElement('a');
    const isNative = window.Capacitor?.isNativePlatform?.();
    link.href = isNative ? 'https://pachax-flow.web.app/' : window.location.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Abrir versión actual';
    Object.assign(link.style, {display:'inline-block', padding:'10px 12px', background:'#92400e', color:'white', borderRadius:'10px', textDecoration:'none', fontWeight:'700'});
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Seguir aquí';
    Object.assign(close.style, {padding:'10px 12px', marginLeft:'8px', border:'1px solid #92400e', borderRadius:'10px', background:'transparent', color:'#78350f', font:'inherit'});
    close.addEventListener('click', () => notice.remove());
    notice.append(title, detail, link, close);
    document.body.append(notice);
  }
  window.addEventListener('vite:preloadError', event => showRecovery(event.payload));
  window.addEventListener('unhandledrejection', event => showRecovery(event.reason));
  // No automatic reload or replay: pending forms and operations stay in this tab.
})();
