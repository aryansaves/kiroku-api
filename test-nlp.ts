import { parseUserMessage } from "./src/bot/nlp";

async function testParser() {
  const inputs = [
    "just finished Vinland Saga S2, 9/10, absolutely brutal ending",
    "reading chapter 45 of chainsaw man, pretty crazy layout",
    "started playing Elden Ring tonight, gonna die a lot",
    "planning to watch Interstellar this weekend",
  ];

  console.log("=== Testing Gemini NLP Extraction Pipeline ===");

  for (const input of inputs) {
    console.log(`\nInput: "${input}"`);
    const result = await parseUserMessage(input);
    console.log("Extracted Payload:");
    console.log(JSON.stringify(result, null, 2));
  }
}

testParser();