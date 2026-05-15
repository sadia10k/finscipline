# CPSC 254 Final Project Report: Finscipline

## 1. What & Why
Finscipline is a conversational personal finance coach designed for individuals who struggle with the rigidity of traditional spreadsheet budgeting or complex financial apps. Users interact with Finscipline via natural language to log spending, set budgets, and plan debt snowball strategies (e.g., "I spent $45 at Target on groceries," or "How should I tackle my credit card debt?"). The app uses an LLM (gpt-4o-mini) with function calling to translate these natural conversations into structured database operations, while simultaneously surfacing alerts for budget misalignment or low savings rates.

Getting the AI behavior right was uniquely challenging because personal finance requires extreme precision and strict boundaries. An LLM's natural tendency is to be helpful and conversational, which leads to two severe problems in a finance app:
1. **Tool-calling ambiguity**: When a user says "I want to pay off my debt," the LLM might just offer encouraging words instead of triggering the `set_extra_debt_payment` tool.
2. **Domain drift**: Without strict constraints, the AI will happily act as a generic chatbot, giving recipes or coding advice instead of focusing on the user's financial health. 

To solve this, I had to build a custom agent loop that forces the LLM to choose between routing queries to an isolated RAG knowledge base for advice, executing precise financial tools, or refusing the prompt entirely.

## 2. Iterations

### V1
**Change**: Initial agent implementation using standard OpenAI tool calling with basic tool descriptions for logging transactions and setting budgets.
**Motivating example**: Test case #1 ("I just spent $50 on groceries at Whole Foods") passed, but Test case #9 ("Is it better to save or pay off debt first?") failed because the agent simply hallucinated generic financial advice without any authoritative grounding.
**Delta**: Accuracy on the 10-case eval set was **40%**. 
**Conclusion**: The metric was low because the agent lacked a mechanism to retrieve verified financial wisdom, relying entirely on its base weights. Next, I decided to implement a Retrieval-Augmented Generation (RAG) tool to ground its advice.

### V2
**Change**: Implemented the `get_rag_advice` tool and instructed the system prompt to use this tool for all general financial questions.
**Motivating example**: Test case #9 now successfully triggered `get_rag_advice`. However, Test case #2 ("Can you give me a recipe for chocolate chip cookies?") and Test case #6 ("How do I build a PC?") failed because the agent would cheerfully try to answer them using its general knowledge.
**Delta**: Accuracy improved from **40%** to **60%**.
**Conclusion**: The metric improved due to better handling of financial advice, but the agent was still acting like a general-purpose chatbot. The next step was to tighten the system prompt to strictly enforce domain boundaries.

### V3
**Change**: Heavily revised the system prompt to include strict refusal conditions: *"If the user asks about ANYTHING unrelated to personal finance (e.g., coding, recipes, sports, history), you MUST politely refuse to answer."*
**Motivating example**: Test case #2 and Test case #6 were specifically failing by providing recipes and PC builds. With the new prompt, the agent successfully recognized these as out-of-bounds and responded with a refusal.
**Delta**: Accuracy improved from **60%** to **70%** (passing the out-of-bounds tests). 
**Conclusion**: The metric moved positively because the LLM respected the negative constraints in the system prompt. Remaining failures (like Test #8 failing to set an extra debt payment) were caused by logical edge cases (the user had no debts in the test DB, so the LLM logically chose not to call the tool). For future iterations, I would improve the evaluation script to seed the database with specific mock data before running tool-dependent test cases.

## 3. Code Walkthrough
When a user types a message like "I spent $50 on groceries," the frontend sends a POST request to the `/chat` endpoint (`backend/main.py:364`). This route delegates the work to the `run_agent` function located in `backend/agent/loop.py:22`. 

Inside `run_agent`, the system first gathers the user's current context (income, budgets, and debts) directly from the database (`backend/agent/loop.py:38-46`). This is crucial because it gives the LLM immediate awareness of the user's financial state without requiring it to call a "fetch_state" tool first. The agent then packages this context into the system prompt and calls the OpenAI API with `tool_choice="auto"`. 

When the LLM decides to log the transaction, it returns a `tool_calls` finish reason. The loop parses this (`backend/agent/loop.py:118`), extracts the function name (`log_transaction`), and executes it via `execute_tool`. The database is updated, and the tool's success message is appended to the message history. The loop then runs a second iteration so the LLM can generate a conversational confirmation like, "I've logged $50 for groceries."

**Design Decision & Rejected Alternative**: 
I considered giving the LLM a single, monolithic `update_database` tool where it would write raw SQL to modify budgets and transactions. I rejected this alternative because it is highly insecure (SQL injection risks) and prone to formatting errors. Instead, I opted for discrete, narrowly scoped Python functions (`log_transaction`, `set_budget`). This ensures that data is validated by Pydantic and SQLAlchemy before it ever touches the database, providing a much safer and more reliable architecture.

## 4. AI Disclosure & Safety
I created the architecture and provided the design for this application, utilizing an AI coding assistant (Kiro/Gemini) with continuous updates to ensure it met the intent of my design. 

The AI assistant was incredibly helpful for scaffolding the frontend UI and writing the CSS, but it did experience specific failures. For example, when I initially asked it to implement user sessions, it created a global `_sessions = {}` dictionary in Python. I quickly realized this meant users could see each other's financial data if they accessed the app concurrently! I recovered from this by instructing the AI to strip out the global variable and implement secure, signed `HttpOnly` cookies using `itsdangerous`. In another instance, the AI hallucinated an older version of the `react-markdown` package syntax, causing the frontend to crash; I fixed this by manually reviewing the npm documentation and prompting the AI with the correct component structure.

**Safety Risk**: 
The primary safety risk in Finscipline is **PII exposure and data privacy**, as sensitive user financial data (income, debt amounts, spending habits) is sent to a third-party LLM (OpenAI) to generate the contextual responses. 
**Mitigation**: 
To mitigate this, the app does not require or store real names, bank account numbers, or SSNs. Furthermore, only aggregated summaries (e.g., total category spending) are injected into the context window, and I rely on OpenAI's API policy which explicitly states that API data is not used to train their models. Users are warned in the `AI_DISCLOSURE.md` that their chat data is processed by OpenAI.
