const API_BASE = 'https://good-job-radar-api.onrender.com';
const LOCAL_JOBS_KEY = 'goodjob-custom-jobs';
const SAVED_KEY = 'goodjob-saved';
const STATUS_KEY = 'goodjob-status';
let apiJobs = [];
let customJobs = JSON.parse(localStorage.getItem(LOCAL_JOBS_KEY) || '[]');
let jobs = [];
let saved = new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || '[]').map(String));
let statuses = JSON.parse(localStorage.getItem(STATUS_KEY) || '{}');
let activeView = 'all', activeChip = 'all', locationValue = 'all', typeValue = 'all', sortValue = 'best', page = 1, toastTimer;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const list = $('#jobs-list');

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function persist() {
  localStorage.setItem(LOCAL_JOBS_KEY, JSON.stringify(customJobs));
  localStorage.setItem(SAVED_KEY, JSON.stringify([...saved]));
  localStorage.setItem(STATUS_KEY, JSON.stringify(statuses));
}
function toast(message) {
  const element = $('#toast'); element.textContent = message; element.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'), 2400);
}
function publishedLabel(value) {
  if (!value) return '近期更新';
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return value;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  return days === 0 ? '今天更新' : days === 1 ? '昨天更新' : `${days} 天前更新`;
}
function fromApi(item) {
  const palette = [['#edf3e7','#5d8058'],['#eaf0fa','#5377b3'],['#f7ede6','#ca8052'],['#f2eff8','#8776aa'],['#e9f4f2','#4f9181']];
  const [logoBg, logoColor] = palette[(item.company || item.title || '').length % palette.length];
  return {...item, id:String(item.id), logo:(item.company || '職').slice(0,2), logoBg, logoColor, sortDate:item.posted || '', posted:publishedLabel(item.posted), status:statuses[String(item.id)] || '觀望', remote:Boolean(item.remote)};
}
function rebuildJobs() { jobs = [...apiJobs.map(fromApi), ...customJobs.map(j => ({...j, id:String(j.id), status:statuses[String(j.id)] || j.status || '觀望'}))]; }
async function loadJobs() {
  list.hidden = false;
  list.innerHTML = '<div class="loading-state">正在從台灣就業通整理職缺…<span class="loading-dot">✳</span></div>';
  try {
    const response = await fetch(`${API_BASE}/api/jobs?limit=1000`, {headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error(`API 回應 ${response.status}`);
    const data = await response.json();
    apiJobs = data.jobs || [];
    rebuildJobs(); render();
    $('#source-status').textContent = data.last_refresh_at ? `資料來源：台灣就業通・更新於 ${new Date(data.last_refresh_at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}` : '資料來源：台灣就業通';
    $('#new-count').textContent = `共 ${apiJobs.length.toLocaleString('zh-TW')} 筆公開職缺`;
  } catch (error) {
    list.hidden = true; $('#empty-state').hidden = false;
    $('#empty-state').innerHTML = `<span>⌁</span><h3>職缺資料正在喚醒中</h3><p>Render 免費服務可能需要約一分鐘啟動。請稍後重新整理；若持續發生，請檢查後端部署狀態。</p><button class="primary-button" id="retry-load">重新載入 ↻</button>`;
    $('#retry-load').addEventListener('click', loadJobs);
    $('#source-status').textContent = '目前無法連線到職缺資料服務';
  }
}
function render() {
  rebuildJobs();
  const query = $('#search-input').value.trim().toLowerCase();
  let result = jobs.filter(job => {
    const searchable = `${job.title} ${job.company} ${job.location} ${(job.tags || []).join(' ')} ${job.description || ''}`.toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (activeView === 'saved' && !saved.has(String(job.id))) return false;
    if (activeView === 'applied' && job.status !== '已投遞') return false;
    if (activeChip === 'saved' && !saved.has(String(job.id))) return false;
    if (activeChip === 'remote' && !job.remote) return false;
    if (activeChip === 'salary' && Number(job.salary_min || 0) < 60) return false;
    if (locationValue !== 'all' && !String(job.location).includes(locationValue)) return false;
    if (typeValue === 'remote' && !job.remote) return false;
    if (typeValue === 'hybrid' && !String(job.type).includes('混合')) return false;
    if (typeValue === 'flex' && !String(job.type).includes('彈性')) return false;
    if (typeValue === 'full' && !String(job.type).includes('全職')) return false;
    if (typeValue === 'part' && !String(job.type).includes('兼職')) return false;
    return true;
  });
  if (sortValue === 'best') result.sort((a,b) => b.score-a.score);
  if (sortValue === 'new') result.sort((a,b) => String(b.sortDate||'').localeCompare(String(a.sortDate||'')));
  if (sortValue === 'salary') result.sort((a,b) => Number(b.salary_min||0)-Number(a.salary_min||0));
  const pageCount = Math.max(1, Math.ceil(result.length / 6));
  page = Math.min(page, pageCount);
  const visibleJobs = result.slice((page - 1) * 6, page * 6);
  list.innerHTML = visibleJobs.map(job => {
    const source = /^https:\/\//i.test(job.source_url || '') ? job.source_url : '';
    return `<article class="job-card" data-id="${esc(job.id)}"><div class="job-main"><div class="company-logo" style="background:${esc(job.logoBg)};color:${esc(job.logoColor)}">${esc(job.logo)}</div><div class="job-content"><div class="job-title-row"><div><div class="job-title">${esc(job.title)}</div><div class="company-name">${esc(job.company)}</div></div><div class="match-badge"><span class="spark">✳</span> ${Number(job.score)||0}% 適合</div></div><div class="job-meta"><span><b>⌖</b>${esc(job.location)}</span><span><b>＄</b>${esc(job.salary)}</span><span><b>◷</b>${esc(job.type)}</span><span><b>◴</b>${esc(job.posted)}</span></div><div class="job-tags">${(job.tags||[]).map((tag,i)=>`<span class="job-tag ${i===0?'green-tag':''}">${esc(tag)}</span>`).join('')}</div></div></div><div class="job-bottom"><div class="fit-reason"><span class="reason-dot">✳</span><span><strong>適合度參考</strong> · ${esc(job.reason)}</span></div><div class="job-actions"><select class="status-select" aria-label="更新求職狀態" data-status="${esc(job.id)}">${['想投遞','觀望','已投遞','不適合'].map(s=>`<option ${job.status===s?'selected':''}>${s}</option>`).join('')}</select><button class="save-button ${saved.has(String(job.id))?'saved':''}" data-save="${esc(job.id)}" aria-label="收藏職缺">${saved.has(String(job.id))?'♥':'♡'}</button>${source?`<a class="job-link" href="${esc(source)}" target="_blank" rel="noopener noreferrer">原始職缺 <span>↗</span></a>`:'<span class="job-link">無原始連結</span>'}</div></div></article>`;
  }).join('');
  $('#empty-state').hidden = result.length > 0;
  list.hidden = result.length === 0;
  $('#result-count').textContent = `${result.length} 個機會`;
  $('#footer-count').textContent = result.length ? `顯示 1–${Math.min(result.length,6)} 筆，共 ${result.length} 筆職缺` : '沒有符合條件的職缺';
  if (result.length) $('#footer-count').textContent = `顯示 ${(page-1)*6+1}–${Math.min(page*6,result.length)} 筆，共 ${result.length} 筆職缺`;
  const firstPage = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pageButtons = Array.from({length:Math.min(5,pageCount)},(_,i)=>firstPage+i).map(n=>`<button class="page-number ${n===page?'current':''}" data-page="${n}">${n}</button>`).join('');
  $('.pagination').innerHTML = `<button aria-label="上一頁" data-page="${Math.max(1,page-1)}" ${page===1?'disabled':''}>←</button>${pageButtons}<button aria-label="下一頁" data-page="${Math.min(pageCount,page+1)}" ${page===pageCount?'disabled':''}>→</button>`;
  $('#nav-total').textContent = apiJobs.length;
  $('#nav-saved').textContent = saved.size;
  $('#stat-matches').innerHTML = `${result.length.toString().padStart(2,'0')} <small>個</small>`;
  $('#stat-saved').innerHTML = `${saved.size.toString().padStart(2,'0')} <small>個</small>`;
  $('#stat-applied').innerHTML = `${jobs.filter(j=>j.status==='已投遞').length.toString().padStart(2,'0')} <small>個</small>`;
  $('#chip-all').textContent = apiJobs.length;
}
function setView(view,label) {
  activeView=view; $$('.nav-link').forEach(a=>a.classList.toggle('active',a.dataset.view===view));
  $('#breadcrumb-current').textContent=label; $('#list-heading').textContent=view==='saved'?'你收藏的機會':view==='applied'?'已投遞的職缺':'為你精選的職缺'; render();
}

$$('.nav-link').forEach(link=>link.addEventListener('click',()=>setView(link.dataset.view,link.textContent.replace(/[\d]/g,'').trim())));
$('#search-input').addEventListener('input',render);
$$('.filter-chip').forEach(button=>button.addEventListener('click',()=>{activeChip=button.dataset.chip;$$('.filter-chip').forEach(chip=>chip.classList.toggle('active',chip===button));if(activeChip==='saved')setView('all','全部職缺');render()}));
$('#clear-filters').addEventListener('click',()=>{activeChip='all';locationValue=typeValue='all';$('#location-label').textContent='所有地點';$('#type-label').textContent='所有類型';$$('.filter-chip').forEach(chip=>chip.classList.toggle('active',chip.dataset.chip==='all'));render()});
$('#location-filter').addEventListener('click',()=>{const choices=['所有地點','台北','新北','台中','新竹'];const current=choices.indexOf($('#location-label').textContent);$('#location-label').textContent=choices[(current+1)%choices.length];locationValue=$('#location-label').textContent==='所有地點'?'all':$('#location-label').textContent;render()});
$('#type-filter').addEventListener('click',()=>{const choices=[['所有類型','all'],['遠端工作','remote'],['全職','full'],['兼職','part']];const next=choices[(choices.findIndex(x=>x[1]===typeValue)+1)%choices.length];typeValue=next[1];$('#type-label').textContent=next[0];render()});
$('#sort-button').addEventListener('click',()=>{const choices=[['最符合','best'],['最近更新','new'],['薪資最高','salary']];const next=choices[(choices.findIndex(x=>x[1]===sortValue)+1)%choices.length];sortValue=next[1];$('#sort-label').textContent=next[0];render()});
list.addEventListener('click',event=>{const button=event.target.closest('[data-save]');if(!button)return;const id=String(button.dataset.save);saved.has(id)?saved.delete(id):saved.add(id);persist();render();toast(saved.has(id)?'已加入收藏':'已取消收藏')});
list.addEventListener('change',event=>{if(!event.target.matches('[data-status]'))return;statuses[String(event.target.dataset.status)]=event.target.value;persist();render();toast(`求職狀態已更新為「${event.target.value}」`)});

const modal=$('#modal-backdrop');function openModal(){modal.hidden=false;setTimeout(()=>$('#job-content').focus(),50)}function closeModal(){modal.hidden=true;$('#job-form').reset()}
$('#add-job').addEventListener('click',openModal);$('#empty-add')?.addEventListener('click',openModal);$('#modal-close').addEventListener('click',closeModal);$('#cancel-modal').addEventListener('click',closeModal);modal.addEventListener('click',event=>{if(event.target===modal)closeModal()});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeModal();if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('#search-input').focus()}});
$('#job-form').addEventListener('submit',event=>{
  event.preventDefault();const raw=$('#job-content').value.trim();if(!raw)return;const lines=raw.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const company=raw.match(/(?:公司|Company)[:：\s]*([^\n，,]+)/i)?.[1]?.trim()||'手動新增';
  const title=raw.match(/(?:職稱|職缺|職位|Title)[:：\s]*([^\n，,]+)/i)?.[1]?.trim()||lines[0].slice(0,40);
  const salaryMatch=raw.match(/(?:月薪|薪資|NT\$|TWD)\s*[:：]?\s*(\d{2,3})\s*[Kk千]?\s*(?:[-~至到]\s*(\d{2,3})\s*[Kk千]?)?/);
  const salaryMin=salaryMatch?Number(salaryMatch[1]):0;const id=`custom-${Date.now()}`;
  customJobs.unshift({id,title,company,logo:company.slice(0,2),logoBg:'#edf3e7',logoColor:'#5d8058',location:(raw.match(/(?:台北|新北|台中|台南|高雄|新竹)[^\n，,]*/)||[])[0]||'地點待確認',salary:salaryMatch?`月薪 ${salaryMatch[1]}K${salaryMatch[2]?`–${salaryMatch[2]}K`:''}`:'薪資面議',salary_min:salaryMin,type:/遠端|remote/i.test(raw)?'遠端工作':'工作型態待確認',posted:'剛剛',score:Math.min(96,70+(salaryMin>=60?12:0)+(/產品|設計|UX|UI/i.test(raw)?8:0)),tags:raw.match(/Figma|UX|UI|產品|設計|AI|行銷|工程|PM/gi)?.slice(0,3)||['手動新增'],reason:'手動加入的職缺，請確認原始資訊。',status:'觀望',remote:/遠端|remote/i.test(raw),description:raw,source_url:/^https:\/\//i.test(raw)?raw:''});
  persist();closeModal();render();toast('職缺已加入你的清單');
});
$('#open-preferences').addEventListener('click',()=>toast('偏好設定即將推出，先用篩選條件探索吧'));
$('#customize-view').addEventListener('click',()=>toast('可以使用上方篩選條件調整結果'));
$('#show-matches').addEventListener('click',()=>{$('#jobs').scrollIntoView({behavior:'smooth'});toast('職缺已依符合度排序')});
$('#add-collection').addEventListener('click',()=>toast('探索清單功能即將推出'));
$('.pagination').addEventListener('click',event=>{const button=event.target.closest('[data-page]');if(!button||button.disabled)return;page=Number(button.dataset.page);render();$('#jobs-list').scrollIntoView({behavior:'smooth',block:'start'})});
$('#today-label').textContent=new Intl.DateTimeFormat('zh-TW',{month:'long',day:'numeric'}).format(new Date());
loadJobs();
