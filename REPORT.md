# CPSC 254 Final Project Report: Finscipline

## 1. What & Why
I built Finscipline because I wanted a personal finance coach that doesn't feel like a chore to use. Most budgeting apps require you to manually categorize every penny in a rigid spreadsheet. Finscipline is completely conversational, you just tell it things like "I spent 45 bucks at Target on groceries" or "How should I tackle my credit card debt?", and it handles all the database updates and math under the hood. It uses gpt-4o-mini with tool calling to make this happen.

Getting the AI behavior right was honestly the hardest part of the project. LLMs naturally want to be overly helpful chatbots, which causes huge problems here. First, it would often just give encouraging advice when I actually needed it to trigger a specific tool (like logging an expense). Second, without tight constraints, it would happily give you cookie recipes or coding tips instead of staying focused on your money. I had to build a custom agent loop that forces the AI to choose between querying a local RAG database for finance tips, running strict database tools, or flat-out refusing the prompt.

## 2. Iterations

### V1
**Change**: I built the initial agent and integrated RAG from the very beginning so it could give smart financial advice. 
**Motivating example**: Test case #9 ("Is it better to save or pay off debt first?") failed hard. The agent was giving generic, hallucinated advice instead of pulling from the RAG index.
**Delta**: Accuracy on my 10-case eval script was sitting at a rough **40%**. 
**Conclusion**: I dug into the RAG setup and realized the URLs I used for the source documents weren't actually fetching the proper data to chunk. The scraper was hitting paywalls and cookie banners, so the embeddings were basically garbage. I had to rewrite the ingestion script to get clean text.

### V2
**Change**: After fixing the RAG data pipeline, the agent was much better at finance questions, but it was still acting like a general chatbot.
**Motivating example**: Test case #2 ("Can you give me a recipe for chocolate chip cookies?") failed because the bot just cheerfully gave me a recipe.
**Delta**: Accuracy bumped up to **60%**, mostly because the RAG questions were passing now.
**Conclusion**: The metric improved, but the bot was still out of bounds. I needed to force the LLM to stay in its lane, so my next step was strict prompt engineering.

### V3
**Change**: I heavily updated the system prompt to include aggressive refusal constraints: "If the user asks about ANYTHING unrelated to personal finance, you MUST politely refuse to answer."
**Motivating example**: Test #2 and Test #6 (asking how to build a PC) finally passed because the LLM recognized they were off-topic and refused them.
**Delta**: Accuracy hit **70%**. 
**Conclusion**: The prompt engineering worked perfectly. The remaining 30% of failures were actually edge cases in my eval script—for example, the agent failed to set an extra debt payment because my test database didn't have any debts loaded yet, so the LLM logically decided not to use the tool. In the future, I'd fix this by seeding the eval database with better mock data.

## 3. Code Walkthrough
When you type "I spent 50 bucks on groceries", the frontend hits the `/chat` API endpoint (`backend/main.py:364`). This route immediately hands the message off to my `run_agent` function over in `backend/agent/loop.py:22`. 

Inside that loop, the very first thing I do is query the database for the user's current income, budget summary, and debt balances (`backend/agent/loop.py:38-46`), and inject all of that directly into the system prompt. This was a huge design decision. I originally thought about giving the LLM a `fetch_current_state` tool to look up budgets itself. I rejected that alternative because it wasted an entire API round-trip just to get basic context, making the chat feel super slow and laggy. Injecting it upfront is way faster.

Once the LLM reads the prompt, it returns a `tool_calls` finish reason. My loop catches this, extracts the tool name (`log_transaction`), and runs the actual Python function to update the database. It then appends the success message to the history and runs the LLM one more time so it can give a natural confirmation back to the user.

## 4. AI Disclosure & Safety
I created the architecture and provided the design for this application, and I used an AI coding assistant with continuous updates to ensure it actually met the intent of my design. 

The AI was super helpful for generating UI components and boilerplate, but it definitely created some massive headaches. For example, when I asked it to implement user login sessions, it created a global `_sessions = {}` Python dictionary. I caught this immediately—if I had shipped that, a user logging in would overwrite the session for everyone else, and people could literally see each other's financial data! I had to manually step in and force it to use cryptographically signed `HttpOnly` cookies instead. Another time, the AI's math for the Debt Snowball was completely wrong because it was just estimating interest instead of using the proper closed-form compound interest formula, which broke my paydown charts until I corrected it.

**Safety Risk**: 
The biggest safety risk for this app is **PII (Personally Identifiable Information) exposure**. We are taking people's sensitive financial situations (their income, debt balances, and spending habits) and sending that text to OpenAI's API to generate responses.
**Mitigation**: 
To mitigate this, the app explicitly does not ask for real names, bank account numbers, or SSNs. Everything is kept strictly anonymous. Furthermore, I rely on the fact that OpenAI's API policy states they do not use API data to train their models, and I added an AI disclosure notice in the repo to make sure users are aware before they start typing.
