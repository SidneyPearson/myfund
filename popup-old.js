let myFunds = [];
let chartInstance = null;
let currentChartData = []; // 暂存当前基金的完整历史数据
let currentFundConfig = null; // 当前正在查看的基金配置
let draggedItemIndex = null; // 拖拽索引

// 注册插件
if (window.Chart && window.ChartZoom) Chart.register(ChartZoom);

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// ================== 初始化与数据 ==================

async function initApp() {
    setupEvents(); // 绑定静态按钮事件
    const store = await chrome.storage.local.get(['funds']);
    myFunds = store.funds || [];
    fetchData();
}

async function fetchData() {
    if (myFunds.length === 0) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('main_container').innerHTML = '<div style="text-align:center;color:#999;margin-top:50px">点击右上角 ➕ 添加第一支基金</div>';
        return;
    }

    const tasks = myFunds.map(f => {
        const url = `http://fundgz.1234567.com.cn/js/${f.code}.js?rt=${Date.now()}`;
        return fetchWithTimeout(url)
            .then(t => {
                const json = JSON.parse(t.match(/jsonpgz\((.*)\)/)[1]);
                return { ...f, ...json, ok: true };
            })
            .catch(() => ({ ...f, ok: false }));
    });

    const results = await Promise.all(tasks);
    myFunds = myFunds.map((f, i) => ({ ...f, ...results[i] }));
    
    renderList();
    calcTotal();
    document.getElementById('loading').style.display = 'none';
}

function fetchWithTimeout(url, ms = 4000) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal }).then(r => r.text());
}

// ================== 列表渲染与拖拽 ==================

function renderList() {
    const activeDiv = document.getElementById('active_section');
    const clearedDiv = document.getElementById('cleared_section');
    activeDiv.innerHTML = '';
    clearedDiv.innerHTML = '';

    let hasCleared = false;

    myFunds.forEach((item, index) => {
        const share = parseFloat(item.share) || 0;
        const isCleared = share === 0;
        
        const card = document.createElement('div');
        card.className = `fund-card ${isCleared ? 'cleared' : ''}`;
        card.draggable = !isCleared;
        card.dataset.index = index;
        
        // 拖拽事件绑定
        if (!isCleared) {
            card.addEventListener('dragstart', handleDragStart);
            card.addEventListener('dragover', handleDragOver);
            card.addEventListener('drop', handleDrop);
            card.addEventListener('dragend', handleDragEnd);
        }
        
        // 点击卡片查看走势
        card.addEventListener('click', (e) => {
            // 如果点击的是编辑按钮，不触发走势图
            if(e.target.closest('.edit-trigger')) return;
            showChart(item);
        });

        // 数据计算
        const gszzl = parseFloat(item.gszzl || 0);
        const gsz = parseFloat(item.gsz || 0); // 实时估值
        const cost = parseFloat(item.cost) || 0;
        const profitToday = (gsz - parseFloat(item.dwjz || 0)) * share;
        const profitTotal = (gsz - cost) * share;
        
        const clr = gszzl >= 0 ? 'up' : 'down';
        const sign = gszzl >= 0 ? '+' : '';

        // === 提醒逻辑 (新需求) ===
        const targetSell = parseFloat(item.target_price) || 0;
        const targetBuy = parseFloat(item.buy_target_price) || 0;
        let alertHtml = '';

        if (item.ok) {
            if (targetSell > 0 && gsz >= targetSell) {
                alertHtml = `<span class="alert-badge alert-sell">🎯止盈</span>`;
            } else if (targetBuy > 0 && gsz <= targetBuy) {
                alertHtml = `<span class="alert-badge alert-buy">💰机会</span>`;
            }
        }

        // 移除内联 onclick，改用 class 标记
        card.innerHTML = `
            <div class="card-row">
                <div style="display:flex; align-items:center">
                    ${!isCleared ? '<span class="drag-handle">::</span>' : ''}
                    <div>
                        <div class="fund-name">${item.name || item.code}</div>
                        <span class="fund-code">${item.code}</span>
                    </div>
                </div>
                <div class="fund-rate ${clr}">${item.ok ? sign + item.gszzl + '%' : '--'}</div>
            </div>
            <div class="card-detail">
                <div style="display:flex; align-items:center">
                    ${alertHtml}
                    <span>持有: ${isCleared ? '0' : share}</span>
                </div>
                <div>今日: <span class="${clr}">${!isCleared ? profitToday.toFixed(2) : '--'}</span></div>
                <div class="edit-trigger" style="text-decoration:underline; cursor:pointer">⚙ 配置</div>
            </div>
        `;

        // 通过 JS 绑定编辑按钮事件
        const editBtn = card.querySelector('.edit-trigger');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止冒泡
                showEdit(index);
            });
        }

        if (isCleared) {
            hasCleared = true;
            clearedDiv.appendChild(card);
        } else {
            activeDiv.appendChild(card);
        }
    });

    clearedDiv.style.display = hasCleared ? 'block' : 'none';
}

// === 简单拖拽逻辑 ===
function handleDragStart(e) {
    draggedItemIndex = +this.dataset.index;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}
function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}
function handleDrop(e) {
    e.preventDefault();
    const targetCard = this;
    const targetIndex = +targetCard.dataset.index;

    if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
        const movedItem = myFunds[draggedItemIndex];
        myFunds.splice(draggedItemIndex, 1);
        myFunds.splice(targetIndex, 0, movedItem);
        saveToStorage();
        renderList();
    }
}
function handleDragEnd() {
    this.classList.remove('dragging');
    draggedItemIndex = null;
}

// ================== 图表核心功能 ==================

async function showChart(fund) {
    currentFundConfig = fund;
    const panel = document.getElementById('chart_panel');
    panel.classList.add('active');
    panel.style.display = 'flex';
    document.getElementById('chart_title').innerText = fund.name || fund.code;
    document.getElementById('chart_subtitle').innerText = `代码: ${fund.code} | 净值: ${fund.dwjz || '--'}`;

    setActiveTimeBtn('1y');

    const url = `http://fund.eastmoney.com/pingzhongdata/${fund.code}.js?t=${Date.now()}`;
    try {
        const text = await fetchWithTimeout(url, 5000);
        const match = text.match(/var Data_netWorthTrend = (\[.*?\]);/);
        if (match) {
            currentChartData = JSON.parse(match[1]);
            updateChartRange('1y');
        }
    } catch (e) {
        alert("图表数据获取失败，可能是网络原因");
    }
}

function updateChartRange(rangeType) {
    if (!currentChartData || currentChartData.length === 0) return;
    setActiveTimeBtn(rangeType);

    const total = currentChartData.length;
    let count = total;
    switch(rangeType) {
        case '1m': count = 22; break; 
        case '3m': count = 66; break;
        case '6m': count = 130; break;
        case '1y': count = 250; break;
        case 'all': count = total; break;
    }
    
    if (count < 20) count = 20;
    if (count > total) count = total;

    const slicedData = currentChartData.slice(-count);
    drawRichChart(slicedData);
}

function setActiveTimeBtn(type) {
    document.querySelectorAll('.time-btn').forEach(b => {
        if(b.dataset.range === type) b.classList.add('active');
        else b.classList.remove('active');
    });
}

function drawRichChart(data) {
    const ctx = document.getElementById('myChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    const labels = data.map(d => formatDate(d.x));
    const values = data.map(d => d.y);
    
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const maxIndex = values.indexOf(maxVal);
    const minIndex = values.indexOf(minVal);

    const highLowPoints = values.map((v, i) => (i === maxIndex || i === minIndex) ? v : null);

    const costPrice = parseFloat(currentFundConfig.cost);
    const targetPrice = parseFloat(currentFundConfig.target_price);
    const buyTargetPrice = parseFloat(currentFundConfig.buy_target_price);
    
    const datasets = [
        {
            label: '净值走势',
            data: values,
            borderColor: '#007bff',
            backgroundColor: 'rgba(0,123,255,0.05)',
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.1
        },
        {
            label: '高低点',
            data: highLowPoints,
            type: 'line',
            pointRadius: 5,
            pointBackgroundColor: (ctx) => {
                const val = ctx.raw;
                if (val === maxVal) return '#d93025';
                if (val === minVal) return '#188038';
                return 'transparent';
            },
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            showLine: false,
            order: 0
        }
    ];

    if (costPrice > 0) {
        datasets.push({
            label: '持仓成本',
            data: Array(values.length).fill(costPrice),
            borderColor: 'rgba(0, 123, 255, 0.6)',
            borderWidth: 1,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false
        });
    }

    if (targetPrice > 0) {
        datasets.push({
            label: '卖出目标',
            data: Array(values.length).fill(targetPrice),
            borderColor: 'rgba(217, 48, 37, 0.8)',
            borderWidth: 1,
            borderDash: [5, 2],
            pointRadius: 0,
            fill: false
        });
    }

    // 新增：买入目标线 (绿色)
    if (buyTargetPrice > 0) {
        datasets.push({
            label: '买入目标',
            data: Array(values.length).fill(buyTargetPrice),
            borderColor: 'rgba(24, 128, 56, 0.8)',
            borderWidth: 1,
            borderDash: [5, 2],
            pointRadius: 0,
            fill: false
        });
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) label += context.parsed.y;
                            return label;
                        }
                    }
                },
                zoom: {
                    limits: { x: { minRange: 20 } },
                    pan: { enabled: true, mode: 'x' },
                    zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
                }
            },
            scales: {
                x: { ticks: { maxTicksLimit: 5, font:{size:10} }, grid: {display:false} },
                y: { position: 'right', grid:{color:'#f5f5f5'} }
            }
        }
    });
}

// ================== 编辑与保存 ==================

function showEdit(index) {
    const f = myFunds[index];
    const panel = document.getElementById('edit_panel');
    panel.classList.add('active');
    panel.style.display = 'flex';
    
    document.getElementById('f_code').value = f.code;
    document.getElementById('f_name').value = f.name || '';
    document.getElementById('f_share').value = f.share || '';
    document.getElementById('f_cost').value = f.cost || '';
    document.getElementById('f_target').value = f.target_price || '';
    document.getElementById('f_buy_target').value = f.buy_target_price || ''; // 新增
    
    document.getElementById('f_index_key').value = index;
    
    // 重新绑定保存按钮
    const saveBtn = document.getElementById('save_btn');
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.addEventListener('click', () => {
        const newF = {
            code: document.getElementById('f_code').value,
            name: document.getElementById('f_name').value,
            share: parseFloat(document.getElementById('f_share').value) || 0,
            cost: parseFloat(document.getElementById('f_cost').value) || 0,
            target_price: parseFloat(document.getElementById('f_target').value) || 0,
            buy_target_price: parseFloat(document.getElementById('f_buy_target').value) || 0, // 新增保存
        };
        myFunds[index] = { ...myFunds[index], ...newF };
        saveToStorage();
        closePanel('edit_panel');
        fetchData();
    });

    const delBtn = document.getElementById('del_btn');
    const newDelBtn = delBtn.cloneNode(true);
    delBtn.parentNode.replaceChild(newDelBtn, delBtn);
    newDelBtn.style.display = 'block';

    newDelBtn.addEventListener('click', () => {
        if (confirm('确认删除?')) {
            myFunds.splice(index, 1);
            saveToStorage();
            closePanel('edit_panel');
            renderList();
            calcTotal();
        }
    });
}

// ================== 通用事件绑定 ==================

function setupEvents() {
    document.getElementById('refresh_btn').addEventListener('click', fetchData);
    
    // 添加按钮
    document.getElementById('add_btn').addEventListener('click', () => {
        const panel = document.getElementById('edit_panel');
        panel.classList.add('active');
        panel.style.display = 'flex';
        document.querySelectorAll('#edit_panel input').forEach(i => i.value = '');
        
        const saveBtn = document.getElementById('save_btn');
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

        newSaveBtn.addEventListener('click', () => {
            const code = document.getElementById('f_code').value;
            if(code.length !== 6) return alert('代码错误');
            myFunds.push({
                code: code,
                name: document.getElementById('f_name').value,
                share: parseFloat(document.getElementById('f_share').value) || 0,
                cost: parseFloat(document.getElementById('f_cost').value) || 0,
                target_price: parseFloat(document.getElementById('f_target').value) || 0,
                buy_target_price: parseFloat(document.getElementById('f_buy_target').value) || 0, // 新增
            });
            saveToStorage();
            closePanel('edit_panel');
            fetchData();
        });

        document.getElementById('del_btn').style.display = 'none'; 
    });
    
    document.querySelectorAll('.close-panel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            closePanel(btn.dataset.target);
        });
    });

    document.getElementById('chart_range_group').addEventListener('click', (e) => {
        if (e.target.classList.contains('time-btn')) {
            updateChartRange(e.target.dataset.range);
        }
    });
}

function closePanel(id) {
    const el = document.getElementById(id);
    el.classList.remove('active');
    setTimeout(() => el.style.display = 'none', 200);
}

// ================== 工具函数 ==================

function calcTotal() {
    let tAmount = 0, tProfitDay = 0, tProfitHold = 0;
    myFunds.forEach(f => {
        const share = parseFloat(f.share)||0;
        if(share > 0) {
            const cur = parseFloat(f.gsz)||0;
            const last = parseFloat(f.dwjz)||0;
            const cost = parseFloat(f.cost)||0;
            
            tAmount += cur * share;
            tProfitDay += (cur - last) * share;
            if(cost > 0) tProfitHold += (cur - cost) * share;
        }
    });
    document.getElementById('total_amount').innerText = tAmount.toFixed(2);
    
    const setColor = (id, val) => {
        const el = document.getElementById(id);
        el.innerText = (val>0?'+':'') + val.toFixed(2);
        el.className = val>0?'up':(val<0?'down':'flat');
    };
    setColor('total_profit_today', tProfitDay);
    setColor('total_profit_holding', tProfitHold);
}

function saveToStorage() {
    const cleanFunds = myFunds.map(f => ({
        code: f.code,
        name: f.name,
        share: f.share,
        cost: f.cost,
        target_price: f.target_price,
        buy_target_price: f.buy_target_price // 保存新字段
    }));
    chrome.storage.local.set({ funds: cleanFunds });
}

function formatDate(timestamp) {
    const d = new Date(timestamp);
    return `${d.getFullYear().toString().slice(2)}/${d.getMonth()+1}/${d.getDate()}`;
}