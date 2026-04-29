namespace cfo_ai_agent;

entity Conversation
{
    key ID : UUID;
    sessionId : String(100);
    question : LargeString;
    answer : LargeString;
    model : String(100);
    createdAt : DateTime;
    tokensUsed : Integer;
}
