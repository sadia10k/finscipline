import ast
import operator

_OPS = {
    ast.Add:  operator.add,
    ast.Sub:  operator.sub,
    ast.Mult: operator.mul,
    ast.Div:  operator.truediv,
    ast.Pow:  operator.pow,
}
_UNARY_OPS = {
    ast.USub: operator.neg,
    ast.UAdd: lambda x: x,
}


def _eval_node(node: ast.expr) -> float:
    if isinstance(node, ast.Constant):
        if not isinstance(node.value, (int, float)):
            raise ValueError("non-numeric constant")
        return float(node.value)
    if isinstance(node, ast.BinOp):
        op = _OPS.get(type(node.op))
        if op is None:
            raise ValueError("unsupported operator")
        left = _eval_node(node.left)
        right = _eval_node(node.right)
        if isinstance(node.op, ast.Div) and right == 0:
            raise ValueError("division by zero")
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise ValueError("exponent too large")
        return op(left, right)
    if isinstance(node, ast.UnaryOp):
        op = _UNARY_OPS.get(type(node.op))
        if op is None:
            raise ValueError("unsupported unary operator")
        return op(_eval_node(node.operand))
    raise ValueError(f"unsupported expression type: {type(node).__name__}")


def calculate(expression: str) -> dict:
    """Evaluate a simple mathematical expression safely using AST parsing."""
    try:
        if len(expression) > 500:
            return {"error": "Expression too long"}
        tree = ast.parse(expression.strip(), mode="eval")
        result = _eval_node(tree.body)
        return {"result": result}
    except Exception as e:
        return {"error": f"Invalid expression: {e}"}
