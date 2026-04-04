/**
 * Stevia — Widget chatbot documentaire RAG
 * Adapté depuis sucre-source/assets/js/components/stevia.js
 * Routes hardcodées (remplace Routing.generate de FosJsRoutingBundle)
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log("STEVIA loaded");

    const toggle    = document.getElementById("stevia-chat-toggle");
    const windowBox = document.getElementById("stevia-chat-window");
    const closeBtn  = document.getElementById("stevia-close-btn");
    const input     = document.getElementById("stevia-input");
    const send      = document.getElementById("stevia-send");
    const messages  = document.getElementById("stevia-messages");
    const typing    = document.getElementById("stevia-typing");

    let messageId = 0;

    // ----------------------------------------------------------------
    // Formatage Markdown léger
    // ----------------------------------------------------------------
    function formatText(text) {
        if (!text) return "";
        let formatted = text;

        // Sauvegarde les liens source AVANT l'échappement
        const sourceLinks = [];
        formatted = formatted.replace(
            /<a href="([^"]+)" target="_blank" class="source-link">([^<]+)<\/a>/g,
            (match) => {
                sourceLinks.push(match);
                return `__SOURCE_LINK_${sourceLinks.length - 1}__`;
            }
        );

        // Échappe le HTML
        formatted = formatted.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Restore les liens source
        sourceLinks.forEach((link, i) => {
            formatted = formatted.replace(`__SOURCE_LINK_${i}__`, link);
        });

        // Markdown bold
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Listes markdown
        formatted = formatted.replace(/^\s*-\s+(.*)$/gm, '<li>$1</li>');
        formatted = formatted.replace(/((<li\b[^>]*>.*?<\/li>\s*)+)/g, '<ul>$1</ul>');

        // Images markdown
        formatted = formatted.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
            '<img src="$2" alt="$1" class="stevia-image" style="max-width:100%;margin:10px 0;border-radius:8px;cursor:pointer;" onclick="window.open(\'$2\',\'_blank\')">'
        );

        formatted = formatted.replace(/\n(?!(<ul|<li|<\/ul|<\/li|<img))/g, '<br>');

        return formatted;
    }

    // ----------------------------------------------------------------
    // Boutons de feedback
    // ----------------------------------------------------------------
    function createFeedbackButtons(msgId, question, answer) {
        const feedbackDiv = document.createElement('div');
        feedbackDiv.className = 'stevia-feedback';
        feedbackDiv.innerHTML = `
            <button class="stevia-feedback-btn positive" data-msg-id="${msgId}" data-feedback="positive" title="Réponse utile">
                <i class="bi bi-hand-thumbs-up"></i>
            </button>
            <button class="stevia-feedback-btn negative" data-msg-id="${msgId}" data-feedback="negative" title="Réponse non pertinente">
                <i class="bi bi-hand-thumbs-down"></i>
            </button>
        `;

        feedbackDiv.querySelectorAll('.stevia-feedback-btn').forEach(btn => {
            btn.addEventListener('click', async function () {
                const feedback = this.dataset.feedback;
                const msgId = this.dataset.msgId;

                feedbackDiv.querySelectorAll('.stevia-feedback-btn').forEach(b => {
                    b.classList.remove('selected');
                    b.disabled = true;
                });
                this.classList.add('selected');

                await sendFeedback(msgId, question, answer, feedback);

                const thanks = document.createElement('div');
                thanks.className = 'stevia-feedback-thanks';
                thanks.textContent = feedback === 'positive'
                    ? 'Merci pour votre retour !'
                    : 'Merci, nous améliorerons nos réponses.';
                feedbackDiv.appendChild(thanks);
            });
        });

        return feedbackDiv;
    }

    async function sendFeedback(msgId, question, answer, feedback) {
        try {
            await fetch('/stevia/feedback', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({
                    message_id: msgId,
                    question: question,
                    answer: answer,
                    feedback: feedback
                })
            });
        } catch (e) {
            console.error('Erreur envoi feedback:', e);
        }
    }

    // ----------------------------------------------------------------
    // Ajout d'un message dans la zone de chat
    // ----------------------------------------------------------------
    function addMessage(text, sender = "bot", question = "") {
        const div = document.createElement("div");
        div.classList.add(sender === "user" ? "user-message" : "bot-message");

        if (sender === "bot") {
            const currentMsgId = ++messageId;
            div.dataset.msgId = currentMsgId;
            div.innerHTML = formatText(text);

            if (text && !text.includes("Comment puis-je vous aider aujourd'hui ?")) {
                const feedbackBtns = createFeedbackButtons(currentMsgId, question, text);
                div.appendChild(feedbackBtns);
            }
        } else {
            div.textContent = text;
        }

        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    }

    // Message de bienvenue
    if (messages && messages.children.length === 0) {
        addMessage(
            "Bonjour ! Je suis **Stevia**, votre assistante documentaire.\n\nComment puis-je vous aider aujourd'hui ?",
            "bot"
        );
    }

    // ----------------------------------------------------------------
    // Streaming SSE vers /stevia/ask/stream
    // ----------------------------------------------------------------
    async function askSteviaStreaming(question) {
        try {
            const response = await fetch('/stevia/ask/stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'same-origin',
                body: JSON.stringify({ question, roles: [window.STEVIA_ROLE || 'user'] })
            });

            if (!response.ok) {
                let errorMsg = "Erreur technique : ";
                if (response.status === 504) {
                    errorMsg = "Le serveur a mis trop de temps à répondre.";
                } else if (response.status === 500) {
                    errorMsg = "Erreur interne du serveur (vérifiez les logs).";
                } else {
                    errorMsg += `impossible de contacter Stevia (${response.status}).`;
                }
                return { answer: errorMsg, question };
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullAnswer = "";

            const currentMsgId = ++messageId;
            const botMessageDiv = document.createElement("div");
            botMessageDiv.classList.add("bot-message");
            botMessageDiv.dataset.msgId = currentMsgId;
            messages.appendChild(botMessageDiv);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.content) {
                            fullAnswer += data.content;
                            botMessageDiv.innerHTML = formatText(fullAnswer);
                            messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
                        }
                    } catch (e) {
                        // chunk incomplet — normal en streaming
                    }
                }
            }

            if (fullAnswer && !fullAnswer.includes("Comment puis-je vous aider")) {
                const feedbackBtns = createFeedbackButtons(currentMsgId, question, fullAnswer);
                botMessageDiv.appendChild(feedbackBtns);
            }

            return fullAnswer || "Réponse vide.";

        } catch (e) {
            console.error(e);
            if (e.name === 'AbortError') return "La requête a été annulée.";
            return "Erreur réseau : Stevia IA n'est pas accessible (le serveur Python est-il démarré ?).";
        }
    }

    // ----------------------------------------------------------------
    // Envoi d'un message
    // ----------------------------------------------------------------
    async function sendMessage() {
        const text = input.value.trim();
        if (!text) return;

        input.disabled = true;
        send.disabled = true;
        addMessage(text, "user");
        input.value = "";

        typing.classList.remove("hidden");
        await askSteviaStreaming(text);
        typing.classList.add("hidden");

        input.disabled = false;
        send.disabled = false;
        input.focus();
    }

    // ----------------------------------------------------------------
    // Healthcheck API
    // ----------------------------------------------------------------
    const statusDot = document.getElementById("stevia-status-dot");

    async function checkApiStatus() {
        if (!statusDot) return;
        try {
            const response = await fetch('/stevia/health', {
                method: 'GET',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            if (!response.ok) throw new Error('proxy health check failed');

            const data = await response.json();
            if (data.status === 'online') {
                statusDot.classList.remove("offline");
                statusDot.classList.add("online");
                statusDot.title = "Stevia est en ligne";
            } else {
                throw new Error('offline');
            }
        } catch (e) {
            statusDot.classList.remove("online");
            statusDot.classList.add("offline");
            statusDot.title = "Stevia est hors ligne";
        }
    }

    if (statusDot) {
        checkApiStatus();
        setInterval(checkApiStatus, 300000); // toutes les 5 min
    }

    // ----------------------------------------------------------------
    // Event listeners — toggle widget
    // ----------------------------------------------------------------
    if (toggle && windowBox) {
        toggle.addEventListener("click", () => {
            const isOpening = windowBox.classList.contains("hidden");
            windowBox.classList.toggle("hidden");
            if (isOpening && input) setTimeout(() => input.focus(), 300);
        });
    }

    if (closeBtn && windowBox) {
        closeBtn.addEventListener("click", () => windowBox.classList.add("hidden"));
    }

    if (send) send.addEventListener("click", sendMessage);

    if (input) {
        input.addEventListener("keydown", e => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        input.addEventListener("input", () => {
            if (send) send.style.opacity = input.value.trim() ? "1" : "0.6";
        });
    }

    // ----------------------------------------------------------------
    // Boutons indexation BookStack (page /stevia/indexation)
    // ----------------------------------------------------------------
    document.querySelectorAll('.btn-index-book').forEach(btn => {
        btn.addEventListener('click', async () => {
            const bookId = btn.dataset.bookId;
            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Indexation…';

            try {
                const response = await fetch(`/stevia/index/book/${bookId}`, {
                    method: 'POST',
                    headers: { 'X-Requested-With': 'XMLHttpRequest' }
                });
                const data = await response.json();
                if (data.status === 'success') window.location.reload();
            } catch (e) {
                console.error(e);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        });
    });

    document.querySelectorAll('.btn-delete-book').forEach(btn => {
        btn.addEventListener('click', async function (e) {
            e.preventDefault();
            e.stopPropagation();

            const bookId   = this.dataset.bookId;
            const bookName = this.dataset.bookName;

            if (!confirm(`Voulez-vous vraiment supprimer l'index de "${bookName}" ?`)) return;

            const originalHTML = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Suppression…';

            try {
                const response = await fetch(`/stevia/delete/book/${bookId}`, {
                    method: 'DELETE',
                    headers: { 'X-Requested-With': 'XMLHttpRequest' }
                });
                const data = await response.json();
                if (data.status === 'success') { window.location.reload(); return; }
            } catch (e) {
                console.error(e);
            }

            btn.disabled = false;
            btn.innerHTML = originalHTML;
        });
    });

    document.getElementById('btn-index-all')?.addEventListener('click', async function (e) {
        e.preventDefault();
        if (!confirm('Souhaitez-vous indexer tous les documents ?\nCette opération peut prendre plusieurs minutes.')) return;

        const btn = this;
        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Indexation en cours…';

        try {
            await fetch('/stevia/index/all', {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            window.location.reload();
        } catch (e) {
            console.error(e);
            alert('Erreur : ' + e.message);
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    });

    document.getElementById('btn-delete-all')?.addEventListener('click', async function (e) {
        e.preventDefault();
        if (!confirm('Souhaitez-vous désindexer tous les documents ?')) return;

        const btn = this;
        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Suppression…';

        try {
            await fetch('/stevia/delete/all', {
                method: 'DELETE',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });
            window.location.reload();
        } catch (e) {
            console.error(e);
            alert('Erreur : ' + e.message);
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    });
});
