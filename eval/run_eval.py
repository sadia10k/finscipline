import json
import os
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.agent.loop import run_agent
from backend.database import get_connection, init_db
from dotenv import load_dotenv

load_dotenv()

def setup_eval_user() -> str:
    init_db()
    shadow_id = "eval_test_user_123"
    with get_connection() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO users (shadow_id, username, password_hash) VALUES (?, ?, ?)",
            (shadow_id, "evaluser", "none")
        )
    return shadow_id

def run_evaluation():
    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY must be set to run evals.")
        sys.exit(1)

    test_cases_file = Path(__file__).parent / "test_cases.json"
    with open(test_cases_file, "r") as f:
        test_cases = json.load(f)

    shadow_id = setup_eval_user()
    
    total = len(test_cases)
    passed = 0

    print(f"Running {total} test cases...\n")

    for tc in test_cases:
        print(f"Test #{tc['id']} | {tc['type']} | Input: '{tc['input']}'")
        messages = [{"role": "user", "content": tc["input"]}]
        
        try:
            result = run_agent(messages, shadow_id)
            tools_called = result.get("tools_called", [])
            reply = result.get("reply", "").lower()
            
            is_pass = False
            
            if tc.get("expected_tool"):
                if tc["expected_tool"] in tools_called:
                    is_pass = True
            elif tc.get("expected_behavior") == "refusal":
                if not tools_called and ("i can only" in reply or "financial" in reply or "i am a financial" in reply or "cannot" in reply or "apologize" in reply or "not able to" in reply):
                    is_pass = True
            
            if is_pass:
                passed += 1
                print("  ✅ PASS")
            else:
                print(f"  ❌ FAIL (Expected: {tc.get('expected_tool') or tc.get('expected_behavior')}, Got Tools: {tools_called}, Reply: {reply[:50]}...)")
                
        except Exception as e:
            print(f"  ❌ ERROR: {e}")

    accuracy = passed / total
    print("\n--- EVALUATION RESULTS ---")
    print(f"Total Tests: {total}")
    print(f"Passed:      {passed}")
    print(f"Failed:      {total - passed}")
    print(f"Accuracy:    {accuracy * 100:.1f}%")
    
    if accuracy >= 0.8:
        print("\nEval Metric: ✅ PASS (>= 80%)")
    else:
        print("\nEval Metric: ❌ FAIL (< 80%)")

if __name__ == "__main__":
    run_evaluation()
