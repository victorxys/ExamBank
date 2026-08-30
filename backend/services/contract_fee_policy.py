"""合同费用字段的业务适用范围。"""

INTRODUCTION_FEE_CONTRACT_TYPES = frozenset({"nanny", "nanny_trial"})


def supports_introduction_fee(contract_or_type) -> bool:
    """只有育儿嫂正式/试工合同允许使用介绍费。"""
    contract_type = getattr(contract_or_type, "type", contract_or_type)
    return contract_type in INTRODUCTION_FEE_CONTRACT_TYPES
