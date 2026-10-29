(()=>{'use strict';
const key='paperscan-theme';
const css=`
body.dw-dark{background:#111827!important;color:#e5e7eb!important;color-scheme:dark}
body.dw-dark main,body.dw-dark .panel,body.dw-dark .card,body.dw-dark .tip,body.dw-dark .setting,body.dw-dark .drop,body.dw-dark .result-item,body.dw-dark .modalbox{background:#1f2937!important;color:#e5e7eb!important;border-color:#374151!important;box-shadow:none}
body.dw-dark header,body.dw-dark .dw-unified-header{background:#111827!important;color:#f9fafb!important;border-color:#374151!important}
body.dw-dark .dw-unified-brand,body.dw-dark .dw-feature-name,body.dw-dark h1,body.dw-dark h2,body.dw-dark h3,body.dw-dark p,body.dw-dark label,body.dw-dark small,body.dw-dark .tag,body.dw-dark .section-head p,body.dw-dark footer{color:#d1d5db!important}
body.dw-dark input,body.dw-dark select,body.dw-dark textarea,body.dw-dark pre,body.dw-dark .drop{background:#111827!important;color:#f9fafb!important;border-color:#4b5563!important}
body.dw-dark .action{background:#374151!important;color:#fff!important}
body.dw-dark .secondary{background:#374151!important;color:#f9fafb!important;border-color:#4b5563!important}
body.dw-dark .dw-theme-toggle{background:transparent;color:inherit;border:1px solid #64748b;border-radius:9px;padding:8px 11px;font:600 13px system-ui;cursor:pointer}
`;
function init(){if(!document.querySelector('#dw-theme-style')){const s=document.createElement('style');s.id='dw-theme-style';s.textContent=css;document.head.append(s)}
const dark=localStorage.getItem(key)==='dark';document.body.classList.toggle('dw-dark',dark);
const existing=document.querySelector('#themeBtn');
if(existing){existing.addEventListener('click',()=>{document.body.classList.toggle('dw-dark',document.body.classList.contains('dark'));});return}
const header=document.querySelector('.dw-unified-right')||document.querySelector('.topbar')||document.querySelector('header .topbar')||document.querySelector('header');
if(!header)return;
const b=document.createElement('button');b.type='button';b.className='dw-theme-toggle';b.textContent=dark?'☀ Light':'☾ Night';b.setAttribute('aria-label','Toggle dark mode');b.style.marginLeft='8px';
b.addEventListener('click',()=>{const on=!document.body.classList.contains('dw-dark');document.body.classList.toggle('dw-dark',on);localStorage.setItem(key,on?'dark':'light');b.textContent=on?'☀ Light':'☾ Night';});
header.append(b);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();