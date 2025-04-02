import base64
import os
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()


def generate(evaluations):
    client = genai.Client(
        api_key=os.environ['GEMINI_API_KEY'],
    )
    
    # 将评价数据转换为markdown格式
    evaluation_text = "# 评价数据\n\n"
    evaluation_text += str(evaluations)

    model = "gemini-2.0-pro-exp-02-05"
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(
                    text=evaluation_text
                ),
            ],
        ),
    ]
    generate_content_config = types.GenerateContentConfig(
        temperature=1,
        top_p=0.95,
        top_k=64,
        max_output_tokens=8192,
        response_mime_type="text/plain",
        system_instruction=[
            types.Part.from_text(
                text="""你是一位资深的月嫂/育儿嫂管理人员，对与客户寻找月嫂/育儿嫂的需求十分了解，同时也对公司内的月嫂/育儿嫂的特点、特征有清晰的认识。我将向你提供公司内员工的评价结果。

请汇总此员工的“个人介绍”(introduction),并对汇总后的个人介绍进行详细描述(more),之后再提炼为简单介绍(description).
请注意我提供的分数满分是80分（对应评价项为“好”），及格为60分（对一个评价项为“一般”，请以此为参考进行描述。
如果我提供信息中有“补充说明”，请在进行员工介绍时着重考虑“补充说明”中的内容。

在下述对员工的称呼中，除了“姓名”，其他时候全部使用员工的”姓“称呼员工为 “某阿姨”
对于客户评价(reviews)中，请随机使用“某阿姨“、”某姐“等称呼，也要避免使用员工的”全名“

然后从以下几个维度来进行详细评价(more)：
1.服务优势(advantages)
	内在品质(name1):精简描述其“内在品质”(description),详细描述其\"内在品质\"(more)
	专业技能(name2):精简描述其“专业技能”(description),详细描述其\"专业技能\"(more)
	职业素养(name3):精简描述其“职业素养”(description),详细描述其\"职业素养\"(more)
2.职业素养(qualities)
	### 注意：此处的内容并不固定，需要从此员工的评价中找到关于“职业素养”的评价，并从中找到分数最高，最能体现员工“职业素养”的4项内容来进行详细描述。其中“职业素养”的name，请使用描述性的词汇，而不是评价中的原词具体格式请参考“服务优势”(advantages)
3.专业技能(skills)
	### 注意：此处的内容并不固定，需要从此员工的评价中找到关于“专业技能”的评价，并从中找到分数最高，最能体现员工“专业技能”的4项内容来进行“打分”(level)，小于4的内容无需显示，分数为5分制。其中“技能名称”(name)请使用描述性的词汇而不是评价中的原词。具体格式如下:
	技能1(name): 5(level)
	技能2(name): 4.5(level)
	技能3(name): 4(level)
	技能4(name): 4(level)
4.客户评价(reviews)
	根据“客户评价”中的得分，为此员工虚拟3段客户评价，格式如下：
	 ***注意，如果没有“客户评价”方面的评分，就不要生成上述“客户评价”的文字内容
	评价内容(content):
	评价人(author): 张先生/女士 （###注意，此处评价人的姓请虚拟）
	评分(rating):

在上述描述详细评价过程中使用描述用的生动的语言，不要任何生硬的表述，也不要评价项的列举。我将用你润色后的内容作为员工介绍，并发送给客户。因此，既不要夸大也不要遗漏员工的优点，让客户觉得我们的员工介绍很专业，通过这个介绍可以很好的了解我们的员工，也了解公司对员工的要求是来自多方面的。在使用辞藻的时候要在用吸引人的、让人印象深刻但是又不夸张、不绝对的方式。对于评价项分数较低没有达到基本要求的评价项，不需要体现在介绍中。

对于“精简描述”在100个中文字符以内json数据中不要显示”总结“字样。
json格式如下：
{
	name: '张三',

	introduction: [description: '{introduction-description}', more: '{introduction-more}']
	advantages: [
	    { name: 'advantages-name', description: 'advantages-name-description' ,more: 'advantages-name-more'},
	    { name: 'advantages-name', description: 'advantages-name-description' ,more: 'advantages-name-more'},
	    { name: 'advantages-name', description: 'advantages-name-description' ,more: 'advantages-name-more'},
	     
	],
	skills: [
	  { name: {skills-name}, level: {skills-name} },
	  { name: {skills-name}, level: {skills-name} },
	  { name: {skills-name}, level: {skills-name} },
	  { name: {skills-name}, level: {skills-name} },
	],
	qualities: [
	  { name: {qualities-name}, description: {qualities-name-decription} , more: {qualities-name-more}},
	  { name: {qualities-name}, description: {qualities-name-decription} , more: {qualities-name-more}},
	  { name: {qualities-name}, description: {qualities-name-decription} , more: {qualities-name-more}},
	  { name: {qualities-name}, description: {qualities-name-decription} , more: {qualities-name-more}},
	],
	reviews: [
	  {
	    content: {reviews-content},
	    author: {reviews-author},
	    rating: {reviews-rating}
	  },
	  {
	    content: {reviews-content},
	    author: {reviews-author},
	    rating: {reviews-rating}
	  },
	  {
	    content: {reviews-content},
	    author: {reviews-author},
	    rating: {reviews-rating}
	  }
	]
};

***注意，输出时只输出上述json数据，不输出其他任何内容，例如“说明”、“建议”等等。请务必确保返回的数据符合json数据格式。"""

            ),
        ],
    )

    response = ""
    for chunk in client.models.generate_content_stream(
        model=model,
        contents=contents,
        config=generate_content_config,
    ):
        response += chunk.text
    
    # 移除可能存在的Markdown代码块标记
    result = response.strip()
    if result.startswith('```json'):
        result = result[7:]
    if result.startswith('```'):
        result = result[3:]
    if result.endswith('```'):
        result = result[:-3:]
    result = result.strip()

    # 尝试解析JSON结果
    try:
        import json
        parsed_result = json.loads(result)
        print('成功解析JSON结果:', parsed_result)
        return parsed_result
    except json.JSONDecodeError as e:
        print('JSON解析失败:', str(e))
        print('无效的JSON文本:', result)
        raise Exception('AI生成的结果不是有效的JSON格式')

def merge_kp_name(exam_results):
    client = genai.Client(
        api_key=os.environ['GEMINI_API_KEY'],
    )
    
    # 将评价数据转换为markdown格式
    # evaluation_text = "# 评价数据\n\n"
    evaluation_text = str(exam_results)
    print("evaluation_text, 用来调试提示词:",evaluation_text)
    # model = "gemini-2.0-flash-lite"
    model = "gemini-2.5-pro-exp-03-25"
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(
                    text=evaluation_text
                ),
            ],
        ),
    ]
    generate_content_config = types.GenerateContentConfig(
        temperature=1,
        top_p=0.95,
        top_k=40,
        max_output_tokens=8192,
        response_mime_type="application/json",
        system_instruction=[
            types.Part.from_text(
                text="""你的主要功能合并、整理知识点的掌握情况。至少合并为5个最多8个知识点，每个知识点下最少有3条数据

基本要求
我将按以下格式提供我的数据：
[{'knowledge_point_name': '10～12个月婴儿身高体重参考范围', 'if_get': '未掌握'}, {'knowledge_point_name': '习惯 & 早教 - 睡眠习惯 - 养成良好的睡前习惯', 'if_get': '未掌握'}]
将我提供的知识点{knowledge_point_name}进行汇总合并生成{subject},并将原{knowledge_point_name} 作为 {details}。
汇总与合并要求：
先理解所有的 {knowledge_point_name}, 并尽量按以下大类进行归类：
生长发育、辅食添加、睡眠、意外伤害、营养性疾病、喂养、早教、常见问题
如果{knowledge_point_name} 不符合以上任何归类，则创造一个相应的{subject}
如果某个 {subject} 下没有任何 {details} 则不汇总这个 {subject}
汇总合并后的 {subject} 数量为最少6个，最多8个。
每个 {subject} 下的 {detials} 数量不得少于3个。


Subject Count: Ensure that the total number of subjects generated is strictly between 6 and 8. If initially, you create more or fewer subjects, you MUST adjust by either merging or further dividing subjects to meet this constraint. Aim for the most logical and comprehensive grouping within this subject count range.

Minimum Details per Subject: Each subject MUST contain a minimum of 3 details. Subjects with fewer than 3 details are not acceptable. If a subject ends up with fewer than 3 details after initial grouping, it MUST be merged with another relevant subject to ensure all subjects meet this minimum detail requirement. Prioritize merging with subjects that are semantically related.

Simultaneous Compliance: Crucially, ensure BOTH of these conditions are met simultaneously. Do not prioritize one constraint over the other; both the subject count and the detail count per subject are equally important and must be satisfied in the final output.

Merging Strategy: When merging subjects to meet the minimum detail count or subject count requirements, intelligently combine related subjects. Do not simply discard details to reduce subject count. Focus on creating broader, yet still coherent, subject categories.

根据数据中的{if_get}来判断每个知识点的掌握情况，累积到合并后的知识点中。按百分比展示合并后知识点的掌握情况。
例如 ：
subject:A
    detials1:已掌握
    detials2:已掌握
    detials3:未掌握
    detials4:已掌握

那么，合并后“subjectA”掌握情况就是75%.

数据处理要求：
1. 请将同一个{subject}中各个{details}进行简化，使得{details}中文字内容无需再重复体现{subject}中的意思或内容
2. 对于{details}相同的条目只保留一个即可，并且同一个{details}不可以出现在不同的{knowledge_point_name}中。
3. 在汇总{subject} 和 {details} 时请注意，如果{details}条目数量少于3条，则不要汇总这个{subject}，并将这些较少的的{details} 合并到其他的{subjcet}中。
4. 精简{details}的文字，保留原意即可，尽量减少各个{details}中重复的文字。
        例如：
        subjcet: 常见问题与护理
              detials: 常见问题 - 疱疹性咽炎 - 定义及特点
            detials: 常见问题 - 疱疹性咽炎 - 症状及护理
            detials: 常见问题 - 疱疹性咽炎 - 定义及特点
            detials: 常见问题 - 幼儿急疹 - 定义及表现 (阶段)
        
        
        精简后是：
        subjcet: 汇总后知识点：常见问题与护理
            detials: 疱疹性咽炎 - 定义及特点
            detials: 疱疹性咽炎 - 症状及护理
            detials: 幼儿急疹 - 定义及表现 (阶段) 
5. 数组中要对 details 内容按文字内容排序


数据格式要求
最终整理为以下json数组格式并输出
[
  {
    subject: '合并后知识点名称1',
    value: 掌握程度数值1,
    details: [
      '知识点详细内容1',
      '知识点详细内容2',
      // ...
    ]
  },
  {
    subject: '合并后知识点名称2',
    value: 掌握程度数值2,
    details: [
      '知识点详细内容1',
      '知识点详细内容2',
      // ...
    ]
  },
  // ...
]
"""
            ),
        ],
    )

    response = ""
    for chunk in client.models.generate_content_stream(
        model=model,
        contents=contents,
        config=generate_content_config,
    ):
        response += chunk.text
    
    # 移除可能存在的Markdown代码块标记
    result = response.strip()
    if result.startswith('```json'):
        result = result[7:]
    if result.startswith('```'):
        result = result[3:]
    if result.endswith('```'):
        result = result[:-3:]
    result = result.strip()

    # 尝试解析JSON结果
    try:
        import json
        parsed_result = json.loads(result)
        print('成功解析JSON结果:', parsed_result)
        return parsed_result
    except json.JSONDecodeError as e:
        print('JSON解析失败:', str(e))
        print('无效的JSON文本:', result)
        raise Exception('AI生成的结果不是有效的JSON格式')


