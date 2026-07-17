# Meal Planner Taxonomy and Logic Design

## Scope

This document captures the current design decisions for a structured household meal planner intended to run as a custom app, with Home Assistant used as a display-only consumer for outputs such as the day’s menu and alerts.[cite:543] The planner is being designed as a mobile-first system, with manual planning as the default mode and auto-planning as an optional later mode.[cite:383][cite:544]

## Product model

The planner is centered on traditional South Indian Iyer-style meal organization, while also allowing clearly tagged non-traditional and North Indian items in controlled categories such as tiffin and side gravies.[cite:375][cite:374] The core design principle is that kitchen knowledge is household-specific, so pairings, accepted dishes, and blocked combinations must be learned and carried forward with reasons such as dislike, allergy, or non-traditional pairing.[cite:449]

The recommended product split is:

- Custom app as the source of truth for taxonomy, logic, memory, inventory, and planning.[cite:543]
- Home Assistant as a display and notification surface only.[cite:543]
- Mobile-first UI as the primary operating surface for the user.[cite:383]

## Planning modes

The system should default to manual mode, where the user selects dishes and the UI displays context-sensitive rule guidance, warnings, and suggestions.[cite:544] An auto mode can exist later, but it should produce a draft recommendation rather than silently overriding the user’s choices.[cite:544]

Recommended mode structure:

| Mode | Purpose | Behavior |
|---|---|---|
| Manual | Primary planning mode | User selects meals; UI shows constraints, pairings, repetition warnings, inventory cues, and guest context.[cite:544] |
| Auto | Assisted planning mode | System proposes a draft plan using rules, memory, inventory, and preferences; user approval required.[cite:544] |

## Core logic layers

The current design calls for multiple logic layers to be evaluated together rather than relying on dish lists alone.[cite:373][cite:449][cite:452] These layers include household preferences, observance restrictions, inventory state, vegetable repetition rules, guest counts, and meal-slot-specific attendance.[cite:373][cite:377][cite:449][cite:541][cite:452]

Recommended order of evaluation:

1. Allergy and hard safety exclusions.[cite:449]
2. Religious, observance, and calendar-based restrictions.[cite:377]
3. Ingredient constraints such as onion and garlic flags on relevant dishes.[cite:378]
4. Meal-slot attendance and guest counts by breakfast, lunch, and dinner.[cite:373]
5. Likes, dislikes, repertoire, and pairing memory.[cite:449]
6. Inventory availability and urgency to use leftovers or on-hand stock.[cite:452]
7. Repetition rules for vegetables and dish forms.[cite:541]
8. Seasonality and quality preference for vegetables.[cite:450]

## Dish-class taxonomy

The current dish-class model includes both traditional South Indian classes and practical modern extensions.[cite:375][cite:451][cite:542] Non-traditional items such as biryani and fried rice are intentionally kept under tiffin rather than being merged into the traditional dish structure.[cite:375]

### Traditional and core classes

| Dish class | Current notes |
|---|---|
| Vathakozambu | Includes ingredient sets and Murungakkai as an added member.[cite:375] |
| Kozhambu | Core traditional class already established.[cite:375] |
| Rasam | Core traditional class already established.[cite:375] |
| Koottu | Includes Suraikkai, Beans, Katharikkai, Cabbage, Chow Chow, and Vaazhaithandu; also includes Aviyal and Porichakootu variations, with Sundaikkai under Porichakootu.[cite:453] |
| Kari | Includes Carrot, Beans, Vaazhaithandu, Cabbage, Vazhaipoo, Avaraikkai, Broccoli, Beet root, and mixed combinations such as Cabbage plus Peas and Carrot plus Peas.[cite:380] |
| Roast Kari | Includes Potato, Senaikkizhangu, Seppankizhangu, Vendaikkai, Cauliflower, Katharikkai, Karunaikkizhangu, Kovakkai, and Vazhaikkai; also includes Soya Chukka, Mushroom Chukka, and Potato Idicha Kari variations.[cite:381] |
| Thuruval | Integrated with salad-style use; Kosumalli is treated as a variation where appropriate.[cite:375][cite:387] |
| Usili | Includes Paruppu Usili and Beans Paruppu Usili.[cite:451] |
| Pachadi | Defined class including Carrot Thayir Pachadi.[cite:388] |
| Thogayal / Thuvayal | Includes Paruppu, Thengai, Peerkangai, Kollu, and Vallarai Keerai.[cite:385] |
| Variety Rice | Includes Lemon, Coconut, Puliyodarai, Katharikkai Sadham or Vaangi Bath, Sambar Sadham, Tomato Sadham, Ellu Sadham, and Arisi Paruppu Sadham.[cite:382] |

### Tiffin class

Tiffin is a major class and includes both South Indian and selected non-traditional or North Indian-style items, while preserving tags such as onion and garlic suitability for observance-sensitive days.[cite:374][cite:376][cite:378]

Representative tiffin families and variants currently captured include:

- Dosai: plain, butter or ghee, kambu, ragi, vendhayam, potato masala, paneer, rava.[cite:376]
- Oothappam: plain, tomato, carrot.[cite:376]
- Aval: plain, lemon, masala.[cite:376]
- Sevai: plain, lemon, tomato, vegetable, sweet potato.[cite:376]
- Pongal: venpongal, godhumai pongal, sakkarai pongal.[cite:374]
- Upma: pachama podi, rava, puli rava, arisi, godhumai rava, bread upma.[cite:374]
- Adai: plain adai.[cite:374]
- Chapathi and related items: phulka, plain, onion, potato, sweet potato chapathi; also parathas and allied North Indian items.[cite:374]
- Poori, bajji, aapam, vadai, fried rice variants, biriyani, cutlet, paneer 65, channa chat, and omelette as already defined additions.[cite:374]

### Side-gravy and child-focused classes

Additional practical classes now being added include a side-gravy grouping and a child-oriented snack grouping.[cite:542] These are useful because they represent real planning units that do not fit neatly into the traditional kuzhambu or tiffin structure.

Recommended side-gravy group currently includes:

- Road Style Mushroom
- Paneer Butter Masala
- SBM as unresolved placeholder
- Veg Stew
- Green Peas Masala
- Paneer Burji
- Dal Makhani
- Kerala Kadalai Curry
- Baby Corn Gravy
- Soya Chunks Gravy
- Pachapayaru Kuruma
- Green Mushroom Palak

This class should later carry subtype and cuisine-style tags such as north Indian side, Kerala side, kuruma, stew, gravy, or semi-dry.[cite:378]

Children’s Snacks currently includes:

- Cut fruits
- Muffins
- Dates cake
- Dates brownie
- Cookies, three types
- Nuts
- Popcorn
- Store-bought snacks[cite:542]

A dedicated placeholder should also exist for child bento-box lunches with four chambers and about 17 ideas to be entered later.[cite:542]

## Ingredient and vegetable modeling

Ingredients should be normalized as shared entities that can appear across multiple dish classes.[cite:454] Carrot is a useful example because it is already explicitly mapped across Sambhar, Kari, Kosumalli, and Oothappam rather than belonging to only one class.[cite:454]

Recommended ingredient-entity fields:

- Canonical English name.[cite:384]
- Tamil name.[cite:384]
- Aliases for lookup.[cite:384]
- Allergy-sensitive flag where relevant, such as groundnut.[cite:449]
- Seasonality and quality preference metadata.[cite:450]
- Common dish-class relations.[cite:454]

An explicit normalization decision already made is that Kadalai should be stored as Groundnut in the ingredient model, while retaining Tamil and alias lookup support.[cite:384]

## Thuruval extension

Thuruval should remain the umbrella class rather than creating a separate salad class.[cite:375][cite:387] It now needs to absorb a broader salad-style and pulse-based ingredient set.

Recommended Thuruval ingredients currently include:

- Groundnut
- Black Channa
- White Channa
- Payaru
- Carrot
- Cucumber
- Sweet Corn
- Red Kidney Beans
- Double Beans[cite:387]

## Sambar modeling

Sambar is being treated as a structured dish template rather than a single flat recipe concept.[cite:383] The planner should support primary and support vegetables, because a vegetable may anchor a Sambar or merely support it.[cite:389]

Current notes include:

- Sambar modeling is already in progress as part of the planner.[cite:383]
- Avarai, Onion, and Sundaikkai can be primary vegetables in Sambar.[cite:389]
- Pairing-sensitive classes such as Pitlai should not allow every vegetable indiscriminately; only certain vegetables should qualify.[cite:389]

## Pairing memory and household repertoire

The planner should not treat pairings as universal truths.[cite:449] Instead, it should remember accepted and blocked pairings at the household or person level, together with reasons such as dislike, allergy, non-traditional pairing, or repertoire mismatch.[cite:449]

Recommended pairing memory fields:

- Source dish.
- Target dish or accompaniment.
- Status: preferred, allowed, blocked, or conditional.
- Reason code, for example allergy or non-traditional pairing.[cite:449]
- Scope: household, person-specific, guest-specific, festival-only, or temporary.[cite:449]

## Meal-slot and guest logic

Guest counts should be meal-slot-specific rather than only day-specific.[cite:373] The planner should separately model breakfast, lunch, and dinner attendance, because dish choice and quantity scaling depend on the actual people present in that slot.[cite:373]

Recommended meal-slot example:

- Breakfast: 4 people.[cite:373]
- Lunch: 8 people.[cite:373]
- Dinner: 6 people.[cite:373]

The planner should also account for guest-specific likes, dislikes, and allergies, such as including Potato Kari when a young child guest is known to like it.[cite:449]

## Family preferences and people model

The planner should track regular family members’ likes, dislikes, allergies, and preference constraints so that plans can be personalized rather than generic.[cite:449] This applies both to meal suggestions and to pairings, and the system must remember blocked items or blocked pairings over time.[cite:449]

Recommended people-related fields:

- Name.
- Role, such as regular family member or guest.[cite:449]
- Age group for child-aware logic.[cite:449]
- Likes and dislikes.[cite:449]
- Allergies and strict avoid items.[cite:449]
- Observance participation where relevant.[cite:377][cite:449]

## Inventory model

Inventory should be treated as a live system that updates from purchases and planned or actual usage, with manual override when estimates are wrong.[cite:452] The system should be able to understand user actions like buying 5 kg of potato and then track the remaining journey of that stock through planning and cooking.[cite:452]

Recommended inventory principles:

- Auto-update inventory from purchase and consumption events where possible.[cite:452]
- Allow manual correction as the truth source when estimates drift.[cite:452]
- Support fridge, pantry, and leftover contexts.[cite:452]
- Distinguish anchor use from support use for ingredients such as carrot.[cite:452]
- Use inventory as a key input to shopping-gap calculation.[cite:373][cite:452]

Timed reminders about inventory should be selective and user-controlled, such as morning, midday, or night, and should not spam the user with constant prompts.[cite:452]

## Repetition and slotting rules

The vegetable repetition engine is one of the key logic layers already defined.[cite:541] The system must support configurable slotting logic for ingredient repetition across days and across forms.[cite:541]

Current default rules are:

1. Vegetables cannot be repeated in any form for 3 days.[cite:541]
2. Vegetables can be repeated in a different form after 3 days.[cite:541]
3. Vegetables in the same form may be repeated only after 14 days.[cite:541]

This implies that the system must store both vegetable identity and form identity, such as carrot in sambar versus carrot in kari.[cite:454][cite:541]

## Observance and restriction logic

The planner must support calendar-based and observance-based food constraints.[cite:377] These include day-specific rules such as amavasai eve and tharpanam or srartham days, where only certain tiffins such as upma, idly, or dosa may be allowed.[cite:377]

The user also wants dish and ingredient structures that support onion and garlic flags so the planner can avoid those items on restricted days and suggest alternatives when needed.[cite:378]

## Notifications and behavioral design

Notifications should be helpful and sparse rather than noisy.[cite:452] Inventory reminders should be timed, selective, and capped so the system behaves more like a polite assistant than a constant interrupter.[cite:452]

Useful notification controls include:

- Reminder windows such as morning, midday, and night.[cite:452]
- Frequency caps per day.[cite:452]
- Cooldowns after dismissal or ignore.[cite:452]
- Digest-style grouping of pending inventory updates.[cite:452]

The system should also collect analytics that improve planning quality, such as accepted suggestions, rejected pairings, repeated overrides, and common manual corrections.[cite:544][cite:449][cite:452]

## Architecture direction

The current architectural direction is to keep the planner logic in a dedicated custom app, while Home Assistant receives outputs for display and possibly notifications.[cite:543] This direction is appropriate because the planner now includes relational taxonomy, household memory, inventory flows, rules engines, and mobile-first planning workflows that exceed the comfort zone of pure Home Assistant configuration.[cite:543][cite:383]

Recommended architecture split:

| Layer | Role |
|---|---|
| Custom app | Taxonomy, rules engine, preferences, inventory, planning UI, analytics.[cite:543] |
| Home Assistant | Display of day’s menu, notes, restrictions, alerts, and other exported outputs.[cite:543] |

## Recommended artifact set

Before moving into implementation, the design should be published as a small artifact pack so the current decisions are versioned and reviewable.[cite:543] A good first pack would contain:

1. A human-readable taxonomy and rules document, which this document represents.[cite:543]
2. A machine-readable schema stub, such as YAML or JSON, capturing dish classes, ingredients, tags, and rule placeholders.[cite:375][cite:451][cite:542]
3. A relational schema draft listing entities and bridge tables for dishes, ingredients, pairings, people, meal slots, observance rules, and inventory transactions.[cite:449][cite:452][cite:541]
4. A planning-logic note that explains evaluation order and override logic.[cite:373][cite:377][cite:449][cite:452]
5. A UI information-architecture note for the mobile-first app and Home Assistant display contract.[cite:383][cite:543][cite:544]

## Suggested next publication approach

The most practical way to publish the current state is to create two immediate artifacts:

- A design handbook in Markdown that summarizes the taxonomy, constraints, naming decisions, and logic layers.[cite:375][cite:449][cite:452]
- A starter machine-readable taxonomy file that mirrors the current classes and placeholders without trying to fully normalize every relationship yet.[cite:451][cite:542]

Once those are reviewed, the next stage can produce the relational schema and API contract for the custom app.[cite:543][cite:544]
