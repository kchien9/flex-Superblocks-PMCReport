---
name: Integrations Available
description: List of connected integrations and their IDs. Use when building new
  APIs to know which data sources are available and their correct UUIDs.
accessType: on_demand
isEnabled: true
createdAt: 2026-07-08T18:33:53.290Z
---

# Available Integrations

## Databases
| Name | ID | Plugin |
|------|----|---------|
| Snowflake (ECE MarketStar Service Account) | `3b367b25-832a-456f-809e-1a034c3f6e5a` | snowflake |
| Snowflake (Hardship Service Account) | `f65294af-a572-43cf-81a6-58b8338d541f` | snowflake |
| Snowflake (SSO) | `d38ee94a-4e93-46f5-ab44-c65a99b3aea5` | snowflake |
| Test Mysql | `e18160bf-93a9-4921-9a86-1b99d959b542` | mysql |

## APIs
| Name | ID | Plugin |
|------|----|---------|
| OpenAI API Key - Parent-Revenue-Department | `e8eb5664-e697-4855-b50a-becb91dddb3b` | openai_v2 |
| Anthropic API Key - Parent-Revenue-Department | `0ba6b240-0e7e-4e31-89d5-4ca3dc7d21ff` | anthropic |
| Notion - Revenue | `3525df5f-aaee-422b-97c2-b3ac766505d9` | notion |
| Slack - Revenue | `43c5bb41-d09f-436b-b986-e84fd3db2058` | slack |
| Google Drive | `c9f04e27-f7b1-4830-9ca2-cbc667a2cc83` | googledrive |
| Github - Repos Read Only | `c0c7eee7-afb5-4f84-a197-2c03b1372b3b` | github |
| Superblocks - Salesforce | `7650b0cb-d056-4bf6-912f-a8d4540762a8` | salesforce |
| LaunchDarkly - Revenue | `0f14a8a2-6ff7-496b-b7e2-006dbe30265a` | launchdarkly |
| Braze - Revenue | `885a5cf8-0e46-4ad4-a5ff-db95e71ae485` | restapiintegration |
| Iterable - Revenue | `5804f1cf-8ac7-4a9f-ab41-df5746c089dd` | restapiintegration |
| Google Sheets REST API | `d8f253d6-d84d-41b3-bdd9-26285c248394` | restapiintegration |
| Jira Cloud - Revenue | `4391a534-363b-4d97-abe4-041ecb28b2ac` | jira |
| Zendesk - Prod(CS) | `83476c51-603d-4113-bb4e-3e26ce17afbd` | zendesk |

## Preferences
- **Primary AI**: Use Anthropic (`0ba6b240`) for generative features
- **Primary Database**: Use Snowflake (SSO) (`cd3edaac`) for analytics/reporting queries
- **CRM**: Salesforce (`7650b0cb`) for account/opportunity data
