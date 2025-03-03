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

请汇总此员工的"个人介绍"(introduction),并对汇总后的个人介绍进行详细描述(more),之后再提炼为简单介绍(description).

然后从以下几个维度来进行详细评价(more)：
1.服务优势(advantages)
	内在品质(name1):精简描述其"内在品质"(description),详细描述其\"内在品质\"(more)
	专业技能(name2):精简描述其“专业技能”(description),详细描述其\"专业技能\"(more)
	职业素养(name3):精简描述其“职业素养”(description),详细描述其\"职业素养\"(more)
2.职业素养(qualities)
	### 注意：此处的内容并不固定，需要从此员工的评价中找到关于“职业素养”的评价，并从中找到分数最高，最能体现员工“职业素养”的4项内容来进行详细描述。其中“职业素养”的name，请使用描述性的词汇，而不是评价中的原词具体格式请参考“服务优势”(advantages)
3.专业技能(skills)
	### 注意：此处的内容并不固定，需要从此员工的评价中找到关于“专业技能”的评价，并从中找到分数最高，最能体现员工“专业技能”的4项内容来进行“打分”(level)，分数为5分制。其中“技能名称”(name)请使用描述性的词汇而不是评价中的原词。具体格式如下:
	技能1(name): 5(level)
	技能2(name): 4.5(level)
	技能3(name): 4(level)
	技能4(name): 4(level)
4.客户评价(reviews)
	根据“客户评价”中的得分，为此员工虚拟3段客户评价，格式如下：
	评价内容(content):
	评价人(author): 张先生/女士 （###注意，此处评价人的姓请虚拟）
	评分(rating):

在上述描述详细评价过程中使用描述用的生动的语言，不要任何生硬的表述，也不要评价项的列举。我将用你润色后的内容作为员工介绍，并发送给客户。因此，既不要夸大也不能遗漏员工的优点，让客户觉得我们的员工介绍很专业，通过这个介绍可以很好的了解我们的员工，也了解公司对员工的要求是来自多方面的。在使用辞藻的时候要在用吸引人的、让人印象深刻但是又不夸张、不绝对的方式。对于评价项分数较低没有达到基本要求的评价项，不需要体现在介绍中。

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