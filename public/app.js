// ============ 全局状态 ============
let currentUser = null;
let currentType = 'single';
let currentSet = 1;
let currentQuestions = [];
let currentIndex = 0;
let userAnswers = {};
let quizStartTime = 0;
let quizSubmitted = false;
let practiceMode = false;

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('quiz_user');
    if (saved) {
        try {
            currentUser = JSON.parse(saved).username;
        } catch(e) { /* ignore */ }
    }
    if (currentUser) {
        showHome();
    } else {
        showPage('login');
    }
});

// ============ 登录/登出 ============
function doLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const errEl = document.getElementById('login-error');
    if (!username || !password) {
        errEl.textContent = '请输入账号和密码';
        errEl.style.display = 'block';
        return;
    }
    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            currentUser = res.username;
            localStorage.setItem('quiz_user', JSON.stringify({ username: res.username }));
            showHome();
        } else {
            errEl.textContent = res.error || '登录失败';
            errEl.style.display = 'block';
        }
    })
    .catch(() => {
        errEl.textContent = '网络错误，请重试';
        errEl.style.display = 'block';
    });
}

function doLogout() {
    currentUser = null;
    localStorage.removeItem('quiz_user');
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').style.display = 'none';
    showPage('login');
}

// 回车登录
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.getElementById('page-login').classList.contains('active')) {
        doLogin();
    }
});

// ============ 页面导航 ============
function showHome() {
    document.getElementById('current-user').textContent = currentUser || '-';
    showPage('home');
}

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + pageId);
    if (page) page.classList.add('active');
    if (pageId === 'question-bank') loadSets(currentType);
    if (pageId === 'history') loadHistory();
    if (pageId === 'wrong') loadWrongQuestions();
    if (pageId !== 'quiz') {
        document.body.style.overflow = '';
    }
}

// ============ 题库选择 ============
function selectType(type) {
    currentType = type;
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
    });
    loadSets(type);
}

function loadSets(type) {
    fetch('/api/index')
        .then(r => r.json())
        .then(index => {
            const sets = index[type].sets;
            const list = document.getElementById('set-list');
            list.innerHTML = '';
            const typeNames = { single: '单选题', multi: '多选题', tf: '判断题' };
            for (let i = 1; i <= sets; i++) {
                const item = document.createElement('div');
                item.className = 'set-item';
                item.innerHTML = `
                    <div class="set-info">
                        <div class="set-name">${typeNames[type]} 第${i}套</div>
                        <div class="set-count">共100题（最后一套可能不足100题）</div>
                    </div>
                    <div class="set-arrow">›</div>
                `;
                item.onclick = () => startQuiz(type, i);
                list.appendChild(item);
            }
        })
        .catch(err => console.error('加载题集失败：', err));
}

// ============ 开始答题 ============
function startQuiz(type, setNum, questions) {
    if (!currentUser) { doLogout(); return; }
    currentType = type;
    currentSet = setNum;
    currentIndex = 0;
    userAnswers = {};
    quizSubmitted = false;
    practiceMode = false;
    quizStartTime = Date.now();
    if (questions) {
        currentQuestions = questions;
        document.getElementById('total-q').textContent = questions.length;
        showPage('quiz');
        renderQuestion();
    } else {
        fetch(`/api/questions/${type}/${setNum}`)
            .then(r => r.json())
            .then(data => {
                currentQuestions = data;
                document.getElementById('total-q').textContent = data.length;
                showPage('quiz');
                renderQuestion();
            })
            .catch(err => alert('加载题目失败：' + err));
    }
}

function renderQuestion() {
    const q = currentQuestions[currentIndex];
    if (!q) return;
    document.getElementById('current-q').textContent = currentIndex + 1;
    document.getElementById('question-text').textContent = (currentIndex + 1) + '. ' + q.question;
    const optList = document.getElementById('options-list');
    optList.innerHTML = '';
    const optionKeys = Object.keys(q.options || {});
    const correctAnswer = q.answer;
    const userAns = userAnswers[currentIndex];
    const userAnswerStr = userAns ? userAns.answer : '';
    optionKeys.forEach(key => {
        const opt = document.createElement('div');
        opt.className = 'option-item';
        if (userAnswerStr && userAnswerStr.includes(key)) {
            opt.classList.add('selected');
        }
        if (quizSubmitted) {
            if (correctAnswer && correctAnswer.includes(key)) {
                opt.classList.add('correct');
            }
            if (userAnswerStr && userAnswerStr.includes(key) && !correctAnswer.includes(key)) {
                opt.classList.add('wrong');
            }
        }
        opt.innerHTML = `
            <div class="option-key">${key}</div>
            <div class="option-text">${q.options[key]}</div>
        `;
        if (!quizSubmitted) {
            opt.onclick = () => selectOption(key);
        }
        optList.appendChild(opt);
    });
    const markBtn = document.getElementById('btn-mark');
    if (userAns && userAns.marked) {
        markBtn.textContent = '已标记';
        markBtn.classList.add('marked');
    } else {
        markBtn.textContent = '标记';
        markBtn.classList.remove('marked');
    }
    if (quizSubmitted) {
        showAnswer();
    } else {
        document.getElementById('answer-area').style.display = 'none';
    }
    updateNavButtons();
}

function selectOption(key) {
    if (quizSubmitted) return;
    let current = userAnswers[currentIndex] || { answer: '', marked: false };
    if (currentType === 'multi') {
        let ans = current.answer || '';
        if (ans.includes(key)) {
            ans = ans.replace(key, '');
        } else {
            ans += key;
        }
        ans = ans.split('').sort().join('');
        current.answer = ans;
    } else {
        current.answer = (current.answer === key) ? '' : key;
    }
    userAnswers[currentIndex] = current;
    renderQuestion();
}

function toggleMark() {
    if (quizSubmitted) return;
    let current = userAnswers[currentIndex] || { answer: '', marked: false };
    current.marked = !current.marked;
    userAnswers[currentIndex] = current;
    renderQuestion();
}

function showAnswer() {
    const q = currentQuestions[currentIndex];
    if (!q) return;
    document.getElementById('correct-answer-text').textContent = q.answer || '-';
    document.getElementById('answer-area').style.display = 'block';
    const expText = document.getElementById('explanation-text');
    if (q.explanation) {
        expText.textContent = q.explanation;
        expText.style.display = 'block';
    } else {
        expText.style.display = 'none';
    }
}

function nextQuestion() {
    if (currentIndex < currentQuestions.length - 1) {
        currentIndex++;
        renderQuestion();
    }
}

function prevQuestion() {
    if (currentIndex > 0) {
        currentIndex--;
        renderQuestion();
    }
}

function updateNavButtons() {}

// ============ 答题卡 ============
function showAnswerCard() {
    document.body.style.overflow = 'hidden';
    const grid = document.getElementById('answer-card-grid');
    grid.innerHTML = '';
    currentQuestions.forEach((q, idx) => {
        const num = document.createElement('div');
        num.className = 'card-num';
        num.textContent = idx + 1;
        const ans = userAnswers[idx];
        if (ans && ans.answer) {
            num.classList.add('done');
        }
        if (ans && ans.marked) {
            num.classList.add('marked');
        }
        if (idx === currentIndex) {
            num.classList.add('current');
        }
        num.onclick = () => {
            currentIndex = idx;
            closeAnswerCard();
            renderQuestion();
        };
        grid.appendChild(num);
    });
    document.getElementById('answer-card-modal').style.display = 'flex';
}

function closeAnswerCard() {
    document.getElementById('answer-card-modal').style.display = 'none';
    document.body.style.overflow = '';
}

// ============ 交卷 ============
function confirmSubmit() {
    let unanswered = [];
    currentQuestions.forEach((q, idx) => {
        const ans = userAnswers[idx];
        if (!ans || !ans.answer) {
            unanswered.push(idx + 1);
        }
    });
    const summary = document.getElementById('submit-summary');
    if (unanswered.length > 0) {
        let displayNums;
        if (unanswered.length > 15) {
            const shown = unanswered.slice(0, 15).join('、');
            displayNums = `${shown} 等共${unanswered.length}题`;
        } else {
            displayNums = unanswered.join('、');
        }
        summary.innerHTML = `您有 <strong style="color:#ff4d4f">${unanswered.length}</strong> 道题未做（题号：${displayNums}），确定要交卷吗？`;
    } else {
        summary.innerHTML = '所有题目已完成，确定要交卷吗？';
    }
    document.getElementById('submit-modal').style.display = 'flex';
}

function closeSubmitModal() {
    document.getElementById('submit-modal').style.display = 'none';
}

function submitQuiz() {
    closeSubmitModal();
    quizSubmitted = true;
    let correct = 0;
    const detail = [];
    currentQuestions.forEach((q, idx) => {
        const ans = userAnswers[idx];
        const userAns = ans ? ans.answer : '';
        const isCorrect = userAns === q.answer;
        if (isCorrect) correct++;
        detail.push({
            number: q.number,
            type: q.type,
            question: q.question,
            userAnswer: userAns,
            correctAnswer: q.answer,
            isCorrect: isCorrect,
            marked: ans ? ans.marked : false
        });
    });
    const total = currentQuestions.length;
    const rate = Math.round((correct / total) * 100);
    document.getElementById('result-correct').textContent = correct;
    document.getElementById('result-total').textContent = total;
    document.getElementById('result-rate').textContent = rate + '%';
    const historyItem = {
        username: currentUser,
        type: currentType,
        typeName: { single: '单选题', multi: '多选题', tf: '判断题' }[currentType],
        setName: practiceMode ? '错题练习' : `第${currentSet}套`,
        correct: correct,
        total: total,
        rate: rate,
        timeUsed: Math.round((Date.now() - quizStartTime) / 1000),
        detail: detail
    };
    if (!practiceMode && currentUser) {
        fetch('/api/history?username=' + encodeURIComponent(currentUser), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(historyItem)
        }).catch(err => console.error('保存历史失败：', err));

        const wrongs = detail.filter(d => !d.isCorrect).map(d => ({
            number: d.number,
            type: d.type,
            question: d.question,
            userAnswer: d.userAnswer,
            correctAnswer: d.correctAnswer,
            addTime: new Date().toLocaleString('zh-CN')
        }));
        if (wrongs.length > 0 && currentUser) {
            fetch('/api/wrong-questions?username=' + encodeURIComponent(currentUser), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(wrongs)
            }).catch(err => console.error('保存错题失败：', err));
        }

        // 错题练习模式：答对后自动从错题集删除
        if (practiceMode && currentUser) {
            detail.forEach(d => {
                if (d.isCorrect) {
                    fetch('/api/wrong-questions/' + d.number + '/' + d.type + '?username=' + encodeURIComponent(currentUser), {
                        method: 'DELETE'
                    }).catch(err => console.error('删除已掌握错题失败：', err));
                }
            });
        }
    }
    showPage('result');
    renderResultCard();
    document.getElementById('result-card').style.display = 'block';
}

// ============ 结果页面 ============
function renderResultCard() {
    const grid = document.getElementById('result-card-grid');
    grid.innerHTML = '';
    currentQuestions.forEach((q, idx) => {
        const ans = userAnswers[idx];
        const userAns = ans ? ans.answer : '';
        const isCorrect = userAns === q.answer;
        const num = document.createElement('div');
        num.className = 'card-num';
        num.textContent = idx + 1;
        if (!userAns) {
            num.classList.add('unanswered');
        } else if (isCorrect) {
            num.classList.add('correct');
        } else {
            num.classList.add('wrong');
        }
        num.onclick = () => {
            currentIndex = idx;
            showPage('quiz');
            renderQuestion();
            showAnswer();
        };
        grid.appendChild(num);
    });
}

function reviewWrong() {
    showPage('result');
    document.getElementById('result-card').style.display = 'block';
    renderResultCard();
}

function showAnswerCardResult() {
    document.getElementById('result-card').style.display = 'block';
    renderResultCard();
}

function retryQuiz() {
    practiceMode = false;
    startQuiz(currentType, currentSet);
}

function goHome() {
    practiceMode = false;
    showHome();
}

// ============ 历史记录 ============
function loadHistory() {
    if (!currentUser) { doLogout(); return; }
    fetch('/api/history?username=' + encodeURIComponent(currentUser))
        .then(r => r.json())
        .then(data => {
            const list = document.getElementById('history-list');
            const empty = document.getElementById('history-empty');
            if (data.length === 0) {
                list.innerHTML = '';
                empty.style.display = 'block';
                return;
            }
            empty.style.display = 'none';
            list.innerHTML = '';
            data.forEach((item, idx) => {
                const el = document.createElement('div');
                el.className = 'history-item';
                el.innerHTML = `
                    <div class="history-info">
                        <div class="history-type">${item.typeName || ''} ${item.setName || ''}</div>
                        <div class="history-date">${item.date || ''}</div>
                    </div>
                    <div class="history-score">${item.correct || 0}/${item.total || 0}</div>
                `;
                el.onclick = () => showHistoryDetail(item);
                list.appendChild(el);
            });
        })
        .catch(err => console.error('加载历史失败：', err));
}

function showHistoryDetail(item) {
    currentQuestions = (item.detail || []).map(d => ({
        number: d.number,
        type: d.type,
        question: d.question,
        answer: d.correctAnswer,
        options: d.options || {},
        explanation: d.explanation || ''
    }));
    currentIndex = 0;
    userAnswers = {};
    (item.detail || []).forEach((d, idx) => {
        userAnswers[idx] = { answer: d.userAnswer || '', marked: d.marked || false };
    });
    quizSubmitted = true;
    showPage('quiz');
    renderQuestion();
    showAnswer();
}

// ============ 错题集 ============
function loadWrongQuestions() {
    if (!currentUser) { doLogout(); return; }
    fetch('/api/wrong-questions?username=' + encodeURIComponent(currentUser))
        .then(r => r.json())
        .then(data => {
            const list = document.getElementById('wrong-list');
            const empty = document.getElementById('wrong-empty');
            if (data.length === 0) {
                list.innerHTML = '';
                empty.style.display = 'block';
                return;
            }
            empty.style.display = 'none';
            list.innerHTML = '';
            data.forEach((w, idx) => {
                const el = document.createElement('div');
                el.className = 'wrong-item';
                el.innerHTML = `
                    <div class="wrong-q">${idx + 1}. ${w.question}</div>
                    <div class="wrong-answer">你的答案：${w.userAnswer || '未答'}</div>
                    <div class="wrong-correct">正确答案：${w.correctAnswer}</div>
                    <div class="wrong-actions">
                        <button class="btn-practice" onclick="practiceWrong(${idx})">练习此题</button>
                        <button class="btn-delete" onclick="deleteWrong(${w.number}, '${w.type}')">删除</button>
                    </div>
                `;
                list.appendChild(el);
            });
        })
        .catch(err => console.error('加载错题失败：', err));
}

function deleteWrong(number, type) {
    if (!confirm('确定要删除这道错题吗？')) return;
    if (!currentUser) return;
    fetch(`/api/wrong-questions/${number}/${type}?username=` + encodeURIComponent(currentUser), {
        method: 'DELETE'
    })
    .then(() => loadWrongQuestions())
    .catch(err => console.error('删除错题失败：', err));
}

// ============ 练习错题 ============
function practiceWrong(idx) {
    if (!currentUser) { doLogout(); return; }
    fetch('/api/wrong-questions?username=' + encodeURIComponent(currentUser))
        .then(r => r.json())
        .then(data => {
            if (data.length === 0) {
                alert('当前没有错题！');
                return;
            }
            // 为每道错题获取完整题目信息
            const questions = new Array(data.length);
            let loaded = 0;
            data.forEach((w, i) => {
                fetch(`/api/question/${w.type}/${w.number}`)
                    .then(r => {
                        if (r.ok) return r.json();
                        return null;
                    })
                    .then(q => {
                        questions[i] = q || {
                            number: w.number, type: w.type, question: w.question,
                            answer: w.correctAnswer, options: w.options || {},
                            explanation: ''
                        };
                        loaded++;
                        if (loaded === data.length) {
                            startPractice(questions.filter(Boolean), idx);
                        }
                    })
                    .catch(() => {
                        questions[i] = {
                            number: w.number, type: w.type, question: w.question,
                            answer: w.correctAnswer, options: w.options || {},
                            explanation: ''
                        };
                        loaded++;
                        if (loaded === data.length) {
                            startPractice(questions.filter(Boolean), idx);
                        }
                    });
            });
        })
        .catch(err => console.error('加载错题失败：', err));
}

function startPractice(questions, startIdx) {
    practiceMode = true;
    currentQuestions = questions;
    currentIndex = (startIdx !== undefined && startIdx < questions.length) ? startIdx : 0;
    userAnswers = {};
    quizSubmitted = false;
    document.getElementById('total-q').textContent = questions.length;
    showPage('quiz');
    renderQuestion();
}

// ============ 退出答题确认 ============
function confirmExitQuiz() {
    if (quizSubmitted || confirm('确定要退出答题吗？当前进度将不会保存。')) {
        practiceMode = false;
        showHome();
    }
}

// ============ 新增题目 ============
function switchAddTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.includes(tab === 'single' ? '单题' : '批量'));
    });
    document.getElementById('add-single').style.display = tab === 'single' ? 'block' : 'none';
    document.getElementById('add-batch').style.display = tab === 'batch' ? 'block' : 'none';
}

function updateAddForm() {
    const type = document.getElementById('add-type').value;
    const optDiv = document.getElementById('add-options');
    if (type === 'tf') {
        optDiv.style.display = 'none';
        document.getElementById('add-answer').placeholder = '判断题填 A(正确) 或 B(错误)';
    } else {
        optDiv.style.display = 'block';
        document.getElementById('add-answer').placeholder = '单选题填A/B/C/D，多选题填AB/ABC等';
    }
}

function submitSingleQuestion() {
    const type = document.getElementById('add-type').value;
    const question = document.getElementById('add-question').value.trim();
    const answer = document.getElementById('add-answer').value.trim().toUpperCase();
    const explanation = document.getElementById('add-explanation').value.trim();
    if (!question || !answer) {
        alert('请填写题目和正确答案！');
        return;
    }
    const q = { question, answer, explanation, number: Date.now() };
    if (type !== 'tf') {
        const optA = document.getElementById('add-option-a').value.trim();
        const optB = document.getElementById('add-option-b').value.trim();
        const optC = document.getElementById('add-option-c').value.trim();
        const optD = document.getElementById('add-option-d').value.trim();
        if (!optA || !optB) {
            alert('请至少填写A和B选项！');
            return;
        }
        q.options = { A: optA, B: optB };
        if (optC) q.options.C = optC;
        if (optD) q.options.D = optD;
    } else {
        q.options = { A: '正确', B: '错误' };
    }
    fetch('/api/questions/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, question: q })
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            alert('题目添加成功！');
            document.getElementById('add-question').value = '';
            document.getElementById('add-option-a').value = '';
            document.getElementById('add-option-b').value = '';
            document.getElementById('add-option-c').value = '';
            document.getElementById('add-option-d').value = '';
            document.getElementById('add-answer').value = '';
            document.getElementById('add-explanation').value = '';
        } else {
            alert('添加失败：' + (res.error || '未知错误'));
        }
    })
    .catch(err => alert('添加失败：' + err));
}

function submitBatchQuestions() {
    const type = document.getElementById('batch-type').value;
    const text = document.getElementById('batch-text').value.trim();
    if (!text) {
        alert('请粘贴题目内容！');
        return;
    }
    const questions = [];
    const lines = text.split('\n');
    let currentQ = null;
    let currentOpts = {};
    let answer = '';
    let explanation = '';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (/^[\d+、．.]+/.test(line)) {
            if (currentQ && answer) {
                questions.push({
                    question: currentQ, options: currentOpts,
                    answer: answer, explanation: explanation,
                    number: Date.now() + questions.length
                });
            }
            currentQ = line.replace(/^[\d+、．.]+?\s*/, '');
            currentOpts = {};
            answer = '';
            explanation = '';
        } else if (/^[A-Da-d][.\、]/.test(line)) {
            const key = line[0].toUpperCase();
            const val = line.replace(/^[A-Da-d][.\、]\s*/, '');
            currentOpts[key] = val;
        } else if (/^答案[：:]/.test(line)) {
            answer = line.replace(/^答案[：:]\s*/, '').trim().toUpperCase();
        } else if (/^解析[：:]/.test(line)) {
            explanation = line.replace(/^解析[：:]\s*/, '').trim();
        } else if (currentQ) {
            currentQ += line;
        }
    }
    if (currentQ && answer) {
        questions.push({
            question: currentQ, options: currentOpts,
            answer: answer, explanation: explanation,
            number: Date.now() + questions.length
        });
    }
    if (questions.length === 0) {
        alert('未解析到题目，请检查格式！');
        return;
    }
    if (!confirm(`共解析到 ${questions.length} 道题目，确认提交？`)) return;
    fetch('/api/questions/batch-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, questions })
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) {
            alert(`成功添加 ${res.added} 道题目！`);
            document.getElementById('batch-text').value = '';
        } else {
            alert('添加失败：' + (res.error || '未知错误'));
        }
    })
    .catch(err => alert('添加失败：' + err));
}
