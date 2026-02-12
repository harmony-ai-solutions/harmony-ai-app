export const migration010 = `
ALTER TABLE chat_messages RENAME TO conversation_messages;
`;
