sap.ui.define([
    'sap/ui/core/mvc/Controller',
    'sap/m/CustomListItem',
    'sap/m/HBox',
    'sap/m/VBox',
    'sap/ui/core/HTML'
], function(Controller, CustomListItem, HBox, VBox, HTML) {
    'use strict';

    return Controller.extend('cfoaiagent.cfoaiagent.ext.view.Main', {

        onInit: function() {
            this._sessionId = 'session-' + Date.now();
        },

        onInputChange: function(oEvent) {
            const val = oEvent.getSource().getValue().trim();
            this.byId('btnSend').setEnabled(val.length > 0);
        },

        onSuggestedQuestion: function(oEvent) {
            const question = oEvent.getSource().getText();
            this.byId('questionInput').setValue(question);
            this.byId('btnSend').setEnabled(true);
            this.onSendQuestion();
        },

        onSendQuestion: function() {
            const oInput = this.byId('questionInput');
            const question = oInput.getValue().trim();
            if (!question) return;

            this._addMessage(question, 'user');
            oInput.setValue('');
            this.byId('btnSend').setEnabled(false);

            const loadingId = this._addLoadingMessage();

            fetch('/service/cfo_ai_agentService/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: question,
                    sessionId: this._sessionId
                })
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                this._removeMessage(loadingId);
                if (data.error) {
                    this._addMessage('Error: ' + data.error.message, 'error');
                } else {
                    this._addMessage(data.answer, 'agent', data.model, data.tokensUsed);
                }
                this._scrollToBottom();
            }.bind(this))
            .catch(function(err) {
                this._removeMessage(loadingId);
                this._addMessage('Error de conexión: ' + err.message, 'error');
            }.bind(this));
        },

        onClearChat: function() {
            const oList = this.byId('chatList');
            oList.removeAllItems();
            this._sessionId = 'session-' + Date.now();
        },

        _addMessage: function(text, type, model, tokens) {
            const oList = this.byId('chatList');
            let bgColor = type === 'user' ? '#0070f2' : '#f0f7ff';
            let textColor = type === 'user' ? '#fff' : '#1a1a1a';
            let border = type === 'user' ? 'none' : '1px solid #cce0fb';
            let radius = type === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px';
            let align = type === 'user' ? 'flex-end' : 'flex-start';
            let meta = (model && tokens) ? '<br/><span style="color:#888;font-size:10px">' + model + ' · ' + tokens + ' tokens</span>' : '';

            if (type === 'error') {
                bgColor = '#fff0f0'; textColor = '#bb0000'; border = '1px solid #ffcccc'; radius = '8px'; align = 'flex-start';
            }

            const oItem = new CustomListItem({
                content: new HTML({
                    content: '<div style="display:flex;justify-content:' + align + ';padding:4px 8px">' +
                        '<div style="background:' + bgColor + ';color:' + textColor + ';border:' + border + ';padding:10px 14px;border-radius:' + radius + ';max-width:80%;font-size:13px;line-height:1.5">' +
                        text + meta +
                        '</div></div>'
                })
            });

            oItem._loadingId = null;
            oList.addItem(oItem);
            this._scrollToBottom();
            return oItem;
        },

        _addLoadingMessage: function() {
            const oList = this.byId('chatList');
            const oItem = new CustomListItem({
                content: new HTML({
                    content: '<div style="padding:10px 16px;color:#0070f2;font-size:12px">⏳ Consultando AI Core...</div>'
                })
            });
            const id = 'loading-' + Date.now();
            oItem._loadingId = id;
            oList.addItem(oItem);
            this._scrollToBottom();
            return id;
        },

        _removeMessage: function(id) {
            const oList = this.byId('chatList');
            const items = oList.getItems();
            for (let i = items.length - 1; i >= 0; i--) {
                if (items[i]._loadingId === id) {
                    oList.removeItem(items[i]);
                    break;
                }
            }
        },

        _scrollToBottom: function() {
            setTimeout(function() {
                const oScroll = this.byId('chatScroll');
                if (oScroll) oScroll.scrollTo(0, 99999, 0);
            }.bind(this), 100);
        }
    });
});