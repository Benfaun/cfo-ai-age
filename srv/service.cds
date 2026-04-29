using { cfo_ai_agent as my } from '../db/schema.cds';

@path : '/service/cfo_ai_agentService'
service cfo_ai_agentService
{
    @cds.redirection.target
    @odata.draft.enabled
    entity Conversations as
        projection on my.Conversation;

    action ask(question: String, sessionId: String) 
        returns { answer: String; model: String; tokensUsed: Integer; };
}

annotate cfo_ai_agentService with @requires :
[
    'authenticated-user'
];