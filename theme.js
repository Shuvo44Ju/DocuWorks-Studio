/* Shared DocuWorks Studio theme: match Document Scanner's moon/sun icon toggle. */
(()=>{
'use strict';
const key='paperscan-theme';
const css=`
:root{color-scheme:light}
body.dark{color-scheme:dark!important;--bg:#101815;--surface:#19231e;--ink:#edf5f0;--muted:#a0b0a8;--line:#2c3a32;--green:#70d6b1;--green2:#233b30;--shadow:0 10px 34px #0004}
body.dark{background:var(--bg,#101815)!important;color:var(--ink,#edf5f0)!important}
body.dark main,body.dark .panel,body.dark .card,body.dark .tip,body.dark .setting,body.dark .drop,body.dark .result-item,body.dark .modalbox{background:var(--surface,#19231e)!important;color:var(--ink,#edf5f0)!important;border-color:var(--line,#2c3a32)!important;box-shadow:none}
body.dark header,body.dark .dw-unified-header{background:var(--surface,#19231e)!important;color:var(--ink,#edf5f0)!important;border-color:var(--line,#2c3a32)!important}
body.dark .dw-unified-brand,body.dark .dw-feature-name,body.dark h1,body.dark h2,body.dark h3,body.dark p,body.dark label,body.dark small,body.dark .tag,body.dark footer{color:var(--ink,#edf5f0)!important}
body.dark input,body.dark select,body.dark textarea,body.dark pre{background:#101815!important;color:#edf5f0!important;border-color:#405047!important}
body.dark .action{background:#233b30!important;color:#edf5f0!important}
body.dark .secondary{background:#233b30!important;color:#edf5f0!important;border-color:#405047!important}
.dw-theme-toggle{border:0!important;background:transparent!important;color:inherit!important;padding:9px!important;border-radius:10px!important;font:20px system-ui!important;cursor:pointer!important;line-height:1!important}
`;
function init(){
if(!document.querySelector('#dw-theme-style')){const s=document.createElement('style');s.id='dw-theme-style';s.textContent=css;document.head.append(s)}
const saved=localStorage.getItem(key)==='dark';document.body.classList.toggle('dark',saved);
const existing=document.querySelector('#themeBtn');
if(existing){existing.textContent=saved?'☀':'☾';return}
const host=document.querySelector('.dw-unified-right')||document.querySelector('.topbar')||document.querySelector('header .topbar')||document.querySelector('header');
if(!host)return;
const b=document.createElement('button');b.id='themeBtn';b.type='button';b.className='dw-theme-toggle';b.textContent=saved?'☀':'☾';b.title='Toggle theme';b.setAttribute('aria-label','Toggle dark mode');
b.addEventListener('click',()=>{const dark=!document.body.classList.contains('dark');document.body.classList.toggle('dark',dark);localStorage.setItem(key,dark?'dark':'light');b.textContent=dark?'☀':'☾';});
host.append(b);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();