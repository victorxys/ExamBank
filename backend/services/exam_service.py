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
        question_points = question.get('points', 1) # 获取问题分数，默认为 1

        # 只对有正确答案的题目进行计分
        if question_name and correct_answer is not None:
            max_possible_score += question_points # 累加最高可能分数
            user_answer = user_answers.get(question_name)
            
            is_correct = False
            # 对不同问题类型进行处理
            if question.get('type') == 'checkbox':
                # 对于多选题，需要确保答案列表内容一致，忽略顺序
                is_correct = sorted(user_answer or []) == sorted(correct_answer)
            else:
                # 对于单选题、填空题等
                is_correct = (user_answer == correct_answer)

            if is_correct:
                total_earned_score += question_points # 累加获得分数
            
            result_details[question_name] = {
                'correct': is_correct,
                'user_answer': user_answer,
                'correct_answer': correct_answer,
                'points': question_points, # 记录该题的分值
                'earned_points': question_points if is_correct else 0 # 记录该题获得的分数
            }

    if max_possible_score == 0:
        return 0, result_details

    score = round((total_earned_score / max_possible_score) * 100)
    return score, result_details
