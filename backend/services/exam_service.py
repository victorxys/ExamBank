def _calculate_exam_score(form_definition, user_answers):
    """
    根据表单定义和用户答案计算考试分数。
    现在支持为每个问题设置分数。
    """
    if not form_definition or 'pages' not in form_definition:
        return 0, {}

    total_earned_score = 0
    max_possible_score = 0
    result_details = {}

    all_elements = [elem for page in form_definition.get('pages', []) for elem in page.get('elements', [])]

    for question in all_elements:
        question_name = question.get('name')
        correct_answer = question.get('correctAnswer')
        points_val = question.get('points', 1)
        question_points = points_val if points_val is not None else 0 # 确保分数不为 None

        # 只对有正确答案的题目进行计分
        if question_name and correct_answer is not None:
            user_answer = user_answers.get(question_name)
            
            is_correct = False
            earned_points = 0
            current_max_points = question_points

            # 检查是否有选项级别的分数 (仅针对多选题)
            choices = question.get('choices', [])
            has_option_scores = False
            if question.get('type') == 'checkbox' and choices:
                # 检查是否至少有一个选项设置了 score
                has_option_scores = any(isinstance(c, dict) and c.get('score') is not None for c in choices)

            if has_option_scores:
                # 场景 1: 选项有分数
                # 计算最高可能分数 (所有正确选项的分数之和)
                option_scores = {c.get('value'): c.get('score', 0) for c in choices if isinstance(c, dict)}
                
                # 计算此题的满分 (基于正确答案)
                calculated_max = 0
                if isinstance(correct_answer, list):
                    for val in correct_answer:
                        calculated_max += float(option_scores.get(val, 0))
                current_max_points = calculated_max
                
                # 计算用户得分
                if isinstance(user_answer, list):
                    for val in user_answer:
                        # 只有选了正确答案才得分 (或者选项本身有分)
                        # 用户说: "只要勾选了这个选项就会得到相应的分数"
                        # 通常这意味着选项本身带有正分。
                        earned_points += float(option_scores.get(val, 0))
                
                # 判断是否完全正确
                # 只有全部选对，且没有多选错的，才算正确
                if isinstance(user_answer, list) and isinstance(correct_answer, list):
                    is_correct = sorted(user_answer) == sorted(correct_answer)
                
            else:
                # 场景 2: 选项无分数 (全对才得分)
                if question.get('type') == 'checkbox':
                    # 对于多选题，需要确保答案列表内容一致，忽略顺序
                    if isinstance(user_answer, list) and isinstance(correct_answer, list):
                        is_correct = sorted(user_answer) == sorted(correct_answer)
                else:
                    # 对于单选题、填空题等
                    is_correct = (user_answer == correct_answer)

                if is_correct:
                    earned_points = question_points

            max_possible_score += current_max_points
            total_earned_score += earned_points
            
            result_details[question_name] = {
                'correct': is_correct,
                'user_answer': user_answer,
                'correct_answer': correct_answer,
                'points': current_max_points, # 记录该题的满分
                'earned_points': earned_points # 记录该题获得的分数
            }

    if max_possible_score == 0:
        return 0, result_details

    score = round((total_earned_score / max_possible_score) * 100)
    return score, result_details
