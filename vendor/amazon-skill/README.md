# amazon-skill

一个面向 AI Agent 和普通 Python/CLI 使用场景的独立 Amazon 调研 Skill。

这个项目从更大的跨境电商运营系统中抽离了可复用的 Amazon 抓取与解析能力，并刻意去掉公司内部数据库、任务队列、权限系统、后台页面、日报流程和其他业务耦合逻辑。

目标很简单：让别人把这个仓库 clone 下来之后，就可以直接使用 Amazon 相关 Tool，或者让 Claude Code、Codex 等 Agent 阅读 `SKILL.md` 后自动组合这些能力完成竞品调研、Listing 调研和关键词排名查询。

## 当前提供的 Tool

- `amazon.search_products`：按关键词搜索 Amazon SERP，获取 ASIN、标题、价格、评分、评论数、自然位和广告位等信息
- `amazon.image_search`：使用 Amazon StyleSnap 进行以图搜竞品
- `amazon.get_product_detail`：根据 ASIN 抓取 `/dp/{ASIN}` 商品详情页，包括 Listing 核心信息
- `amazon.get_related_products`：抓取商品页里的关联商品模块，例如 Frequently Bought Together、相关商品等
- `amazon.get_promotions`：抓取 Deal、Coupon 和其他促销信息
- `amazon.get_reviews`：抓取近期评论，并支持按评分筛选，例如专门获取 1～3 星差评
- `amazon.get_keyword_rank`：查询指定 ASIN 在指定关键词下的自然排名或 SP 广告排名

这些 Tool 只负责采集和返回证据，不负责替你保存数据库、生成日报或执行公司内部 SOP。

## 安装

建议先创建独立 Python 虚拟环境：

```bash
python -m venv .venv
```

Linux / macOS：

```bash
source .venv/bin/activate
```

Windows：

```powershell
.venv\Scripts\activate
```

然后安装项目：

```bash
pip install -e .
```

安装完成后，可以先执行：

```bash
amazon-skill tools
```

查看当前可用 Tool。

## 给 AI Agent 使用

仓库内已经准备了几种 Agent 发现入口：

- Claude Code：`.claude/skills/amazon-skill/SKILL.md`
- Codex / 其他会读取仓库规则的 Agent：`AGENTS.md`
- 通用 Agent Skill 说明：根目录 `SKILL.md`

其中根目录的 `SKILL.md` 是完整说明，里面写了：

- 有哪些 Tool
- 每个 Tool 什么时候用
- 参数是什么
- 输出是什么
- 失败时应该怎么处理
- 做竞品调研时 Tool 应该按什么顺序组合

所以对于支持 Agent Skills 的 Agent，通常不需要让模型自己猜怎么调用。

## CLI 使用示例

### 1. 查看所有 Tool

```bash
amazon-skill tools
```

### 2. 按关键词搜索竞品

```bash
amazon-skill search \
  --keyword "security camera" \
  --marketplace US \
  --max-pages 2
```

典型返回字段包括：

- ASIN
- 标题
- 价格
- 评分
- 评论数
- 当前页码
- 当前页面位置
- 自然排名
- 是否为 Sponsored 广告

### 3. 以图搜竞品

```bash
amazon-skill image-search \
  --image ./target.jpg \
  --marketplace US
```

`--image` 可以传本地图片路径，也可以传图片 URL，并且可以重复传入多张图片。

目前从原项目中验证过的 StyleSnap 站点为：

- US
- DE
- IT
- ES
- JP

### 4. 获取 ASIN 商品详情

```bash
amazon-skill detail \
  --asin B0XXXXXXXX \
  --marketplace US
```

用于获取 Listing 层面的商品信息。

### 5. 获取关联商品

```bash
amazon-skill related \
  --asin B0XXXXXXXX \
  --marketplace US
```

用于观察 Amazon 商品页中出现的关联推荐，例如：

- Frequently Bought Together
- Deals on related products
- 4 stars and above

这些结果可能因为账号、配送地址、Session 或 Amazon A/B 测试而变化，因此应该当作“当前页面观察结果”，而不是永久固定关系。

### 6. 获取促销信息

```bash
amazon-skill promotions \
  --asin B0XXXXXXXX \
  --marketplace US
```

会尝试解析：

- Deal
- Coupon / Voucher
- 其他促销文案

### 7. 获取近期评论或差评

```bash
amazon-skill reviews \
  --asin B0XXXXXXXX \
  --marketplace US \
  --max-pages 2 \
  --max-rating 3
```

这个例子表示获取最高 3 星的评论，适合竞品差评调研。

需要注意：抓到的评论只是采样结果，不应该把少量采样评论直接当成整个 Listing 的完整评论分布。

### 8. 查询关键词自然排名

```bash
amazon-skill rank \
  --asin B0XXXXXXXX \
  --keyword "security camera" \
  --marketplace US \
  --type organic \
  --max-pages 10
```

查询 SP 广告排名时：

```bash
amazon-skill rank \
  --asin B0XXXXXXXX \
  --keyword "security camera" \
  --marketplace US \
  --type sp \
  --max-pages 10
```

排名结果采用“页码 + 页内位置”的方式表示。

例如：

```text
2-8
```

表示第 2 页中的第 8 个对应位置。

排名 Tool 会尝试统一配送邮编并验证第一页的配送位置。如果配送地址验证失败，不会伪造一个排名结果。

## Python 调用示例

除了 CLI，也可以直接当 Python 包使用：

```python
from amazon_skill import search_products, get_product_detail, get_reviews

results = search_products(
    ["security camera"],
    marketplace="US",
    max_pages=1,
)

product = get_product_detail(
    "B0XXXXXXXX",
    marketplace="US",
)

reviews = get_reviews(
    "B0XXXXXXXX",
    marketplace="US",
    max_rating=3,
)
```

这意味着你也可以很方便地再封装成：

- MCP Server
- LangChain Tool
- LangGraph Tool
- OpenAI Agent Tool
- Claude Code Skill
- 自己的 Web API

而不需要依赖原来的跨境运营平台。

## Cookie 配置

Amazon 的部分页面和排名采集会受到 Session、配送地址和风控影响，因此建议配置 Cookie。

可以配置一个通用 Cookie 文件：

```bash
AMAZON_COOKIE_FILE=/absolute/path/to/amazon-cookies.json
```

也可以按站点分别配置：

```bash
AMAZON_COOKIE_FILE_US=/absolute/path/to/us-cookies.json
AMAZON_COOKIE_FILE_JP=/absolute/path/to/jp-cookies.json
AMAZON_COOKIE_FILE_DE=/absolute/path/to/de-cookies.json
```

目前支持的 Cookie 文件格式包括：

- 普通 JSON 对象
- Playwright 风格 JSON Cookie 列表
- Netscape Cookie 文件

关键词排名功能目前建议配置 Cookie，并依赖它完成配送位置设置和验证。

**不要把真实 Cookie 提交到 GitHub。**

`.gitignore` 已经用于避免常见本地敏感配置被提交，但使用时仍然要自己注意不要泄露：

- Cookie
- Amazon 登录信息
- 代理账号密码
- API Key
- 其他账号 Secret

## 代理配置

可以配置统一代理：

```bash
AMAZON_PROXY=http://127.0.0.1:7890
```

也可以按站点配置：

```bash
AMAZON_PROXY_US=http://127.0.0.1:7890
AMAZON_PROXY_JP=http://127.0.0.1:7890
```

是否需要代理取决于你的服务器地区、Amazon 站点和网络环境。

## 支持的 Amazon 站点

核心页面工具目前包含以下 Marketplace 配置：

- US：美国
- CA：加拿大
- JP：日本
- UK：英国
- FR：法国
- IT：意大利
- DE：德国
- ES：西班牙
- IN：印度
- MX：墨西哥
- AU：澳大利亚

不同功能的实际可用站点可能略有区别，例如 StyleSnap 目前只保留已经验证过的几个站点。

## 推荐的竞品调研流程

如果交给 AI Agent 做完整竞品调研，推荐顺序是：

```text
关键词搜索竞品
        ↓
如果有产品图片，再进行以图搜竞品
        ↓
筛选真正相关的候选 ASIN
        ↓
获取目标产品和竞品 Listing 详情
        ↓
获取 Amazon 关联商品
        ↓
获取 Coupon / Deal / Promotion
        ↓
获取近期评论和差评
        ↓
有明确关键词需求时再查询自然位 / SP 排名
        ↓
Agent 基于这些原始证据生成竞品分析
```

核心原则是：

**Tool 负责拿数据，Agent 负责分析。**

不要把“抓数据”和“生成业务结论”重新全部塞回一个巨型 Tool，否则以后很难复用。

## 测试

本地运行测试：

```bash
python -m unittest discover -s tests -v
```

仓库也已经配置 GitHub Actions，会在 Python 3.11、3.12 和 3.13 上运行 parser 测试。

## 项目设计原则

这个仓库只保留可以独立复用的 Amazon 能力。

不会包含原业务系统中的：

- 公司数据库
- 用户权限
- 店铺权限
- 定时任务
- 日报
- 后台页面
- 企业内部规则
- 公司 SOP
- 业务流程状态

例如原系统可能是：

```text
从数据库读取竞品 ASIN
→ 调 Amazon
→ 保存数据库
→ 生成日报
→ 发预警
```

在这个项目中只保留：

```text
输入 ASIN / 关键词
→ 调 Amazon
→ 解析
→ 返回标准 JSON
```

调用方想怎么保存、分析、展示，是调用方自己的事情。

## 异常与风控处理

Amazon 页面结构和反爬策略会持续变化。

如果出现以下情况：

- CAPTCHA / Robot Check
- HTTP 请求失败
- 页面解析失败
- 配送地址验证失败
- 页面结构发生变化

Tool 应该明确返回失败，而不是编造数据。

这个项目不会自动绕过或破解 CAPTCHA。

同时请根据你自己的使用场景，遵守适用法律、Amazon 规则和相关服务条款。

## 当前状态

目前已经完成第一版独立抽离，主链路覆盖：

```text
关键词找竞品
+ 以图搜竞品
+ Listing 详情
+ 关联商品
+ 促销
+ 评论/差评
+ 自然排名/SP 排名
```

后续建议优先做真实 Amazon 页面实测和解析兼容性修正，而不是继续无上限增加 Tool。
