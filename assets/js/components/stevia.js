document.addEventListener('DOMContentLoaded', () => {
    console.log("STEVIA loaded");

    const toggle = document.getElementById("stevia-chat-toggle");
    const windowBox = document.getElementById("stevia-chat-window");
    const closeBtn = document.getElementById("stevia-close-btn");

    const input = document.getElementById("stevia-input");
    const send = document.getElementById("stevia-send");
    const messages = document.getElementById("stevia-messages");
    const typing = document.getElementById("stevia-typing");

    let messageId = 0;

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

        // Échappe le HTML (sauf les liens sauvegardés)
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

        // Images
        formatted = formatted.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
            '<img src="$2" alt="$1" class="stevia-image" style="max-width: 100%; margin: 10px 0; border-radius: 8px; cursor: pointer;" onclick="window.open(\'$2\', \'_blank\')">'
        );

        formatted = formatted.replace(/\n(?!(<ul|<li|<\/ul|<\/li|<img))/g, '<br>');

        return formatted;
    }

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
            btn.addEventListener('click', async function() {
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
            const url = Routing.generate('stevia_feedback');
            await fetch(url, {
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

    function simulateBotReply() {
        typing.classList.remove("hidden");
        setTimeout(() => {
            messages.scrollTo({
                top: messages.scrollHeight,
                behavior: 'smooth'
            });
        }, 100);

        return div;
    }

    if (messages && messages.children.length === 0) {
        addMessage(
            "Bonjour ! Je suis **Stevia**, votre assistante documentaire.\n\nComment puis-je vous aider aujourd'hui ?",
            "bot"
        );
    }

    async function askSteviaStreaming(question) {
        try {
            const url = Routing.generate('stevia_ask_stream');

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'same-origin',
                body: JSON.stringify({question})
            });

            if (!response.ok) {
                console.error("Erreur HTTP:", response.status, response.statusText);

                let errorMsg = "Erreur technique : ";
                if (response.status === 504) {
                    errorMsg = "Le serveur a mis trop de temps à répondre.";
                } else if (response.status === 500) {
                    errorMsg = "Erreur interne du serveur (vérifiez les logs).";
                } else {
                    errorMsg += `impossible de contacter Stevia (${response.status}).`;
                }

                return { answer: errorMsg, question: question }
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
                const {done, value} = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, {stream: true});
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.content) {
                            fullAnswer += data.content;
                            botMessageDiv.innerHTML = formatText(fullAnswer);

                            messages.scrollTo({
                                top: messages.scrollHeight,
                                behavior: 'smooth'
                            });
                        }
                    } catch (e) {

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

            if (e.name === 'AbortError') {
                return "La requête a été annulée après timeout.";
            }

            return "🔌 Erreur réseau : Stevia IA n'est pas accessible (Le serveur Python est-il lancé ?).";
        }
    }

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

    const statusDot = document.getElementById("stevia-status-dot");

    async function checkApiStatus() {
        if (!statusDot) return;

        try {
            const url = Routing.generate('stevia_health');
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                throw new Error('API proxy health check failed');
            }

            const data = await response.json();

            if (data.status === 'online') {
                statusDot.classList.remove("offline");
                statusDot.classList.add("online");
                statusDot.title = "🟢 Stevia est en ligne";
            } else {
                throw new Error('API is offline');
            }

        } catch (e) {
            statusDot.classList.remove("online");
            statusDot.classList.add("offline");
            statusDot.title = "🔴 Stevia est hors ligne";
        }
    }

    if (statusDot) {
        checkApiStatus();
        setInterval(checkApiStatus, 300000);
    }

    // CHATBOT EVENT LISTENERS
    if (toggle && windowBox) {
        toggle.addEventListener("click", () => {
            const isOpening = windowBox.classList.contains("hidden");
            windowBox.classList.toggle("hidden");

            if (isOpening && input) {
                setTimeout(() => input.focus(), 300);
            }
        });
    }

    if (closeBtn && windowBox) {
        closeBtn.addEventListener("click", () => {
            windowBox.classList.add("hidden");
        });
    }

    if (send) {
        send.addEventListener("click", sendMessage);
    }

    if (input) {
        input.addEventListener("keydown", e => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        input.addEventListener("input", () => {
            if (send) {
                send.style.opacity = input.value.trim() ? "1" : "0.6";
            }
        });
    }

    // INDEXATION BOOKSTACK
    document.querySelectorAll('.btn-index-book').forEach(btn => {
        btn.addEventListener('click', async () => {
            const bookId = btn.dataset.bookId;
            const originalText = btn.textContent;

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Indexation...';

            try {
                const url = Routing.generate('stevia_index_book', {bookId: bookId});
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                const data = await response.json();

                if (data.status === 'success') {
                    window.location.reload();
                }

            } catch (e) {
                console.error(e);
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });
    });


    // DESINDEXATION LIVRE BOOKSTACK
    document.querySelectorAll('.btn-delete-book').forEach(btn => {
        btn.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();

            const bookId = this.dataset.bookId;
            const bookName = this.dataset.bookName;

            const confirmed = await confirm(`Voulez-vous vraiment supprimer "${bookName}" ?`);

            if (!confirmed) {
                return;
            }

            const originalHTML = btn.innerHTML;

            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Suppression...`;

            try {
                const url = Routing.generate('stevia_delete_book', { bookId: bookId });

                const response = await fetch(url, {
                    method: 'DELETE',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                const data = await response.json();

                if (data.status === 'success') {
                    window.location.reload();
                    return;
                }

                btn.disabled = false;
                btn.innerHTML = originalHTML;

            } catch (e) {
                console.error(e);
                btn.disabled = false;
                btn.innerHTML = originalHTML;
            }
        });
    });

    // INDEXER TOUS LES LIVRES
    document.getElementById('btn-index-all')?.addEventListener('click', async function(e) {
        e.preventDefault();
        e.stopPropagation();

        const confirmed = await confirm('Souhaitez-vous indexer tous les documents ?\nCette opération peut prendre plusieurs minutes.');

        if (!confirmed) {
            return;
        }

        const btn = this;
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Indexation en cours...';

        try {
            const url = Routing.generate('stevia_index_all');
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            await response.json();
            window.location.reload();

        } catch (e) {
            console.error(e);
            alert('Erreur : ' + e.message);
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });

    // SUPPRIMER TOUS LES INDEX
    document.getElementById('btn-delete-all')?.addEventListener('click', async function(e) {
        e.preventDefault();
        e.stopPropagation();

        const confirmed = await confirm('Souhaitez-vous désindexer tous les documents ?');

        if (!confirmed) {
            return;
        }

        const btn = this;
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Suppression...';

        try {
            const url = Routing.generate('stevia_delete_all');
            const response = await fetch(url, {
                method: 'DELETE',
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            await response.json();
            window.location.reload();

        } catch (e) {
            console.error(e);
            alert('Erreur : ' + e.message);
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });
});