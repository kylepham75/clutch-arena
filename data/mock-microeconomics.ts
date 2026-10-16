import { questionBankSchema, type StudyPack } from "@/lib/schemas/question";

export const mockMicroeconomics: StudyPack = {
  id: "microeconomics-demo",
  title: "Microeconomics essentials",
  subtitle: "Five big ideas. One focused run.",
  questions: questionBankSchema.parse([
    {
      id: "elasticity",
      question:
        "A café raises the price of its lattes by 10%. The quantity demanded falls by 20%. What does this tell you about demand?",
      options: [
        "Demand is perfectly inelastic",
        "Demand is price elastic",
        "Demand is unit elastic",
        "Demand is price inelastic",
      ],
      correctIndex: 1,
      explanation:
        "The absolute price elasticity is 20 ÷ 10 = 2. Because it is greater than 1, quantity demanded responds more than proportionally to price.",
      conceptVariant: {
        question:
          "A cinema lowers ticket prices by 5% and ticket sales increase by 15%. What is the absolute price elasticity of demand?",
        options: ["0.33", "1", "3", "0.75"],
        correctIndex: 2,
        explanation:
          "Elasticity = |15% ÷ −5%| = 3. Demand is elastic because the percentage change in quantity is larger than the percentage change in price.",
      },
    },
    {
      id: "opportunity-cost",
      question:
        "You spend two hours studying instead of taking a tutoring job that would pay $30. What is the opportunity cost of studying?",
      options: [
        "The $30 you could have earned",
        "The price of your textbooks",
        "Zero, because studying is free",
        "All your future earnings",
      ],
      correctIndex: 0,
      explanation:
        "Opportunity cost is the value of the next-best alternative you give up. Here, that is the $30 tutoring payment.",
      conceptVariant: {
        question:
          "You use a free concert ticket instead of working a shift worth $45. The ticket cannot be resold. What is your opportunity cost?",
        options: ["$0", "The ticket’s original price", "$90", "$45"],
        correctIndex: 3,
        explanation:
          "The forgone shift is the next-best alternative. Even with a free ticket, attending has an opportunity cost of $45.",
      },
    },
    {
      id: "price-ceiling",
      question:
        "A binding price ceiling is set below the market equilibrium price. What is the most likely result?",
      options: [
        "A surplus",
        "A shortage",
        "No change in quantity traded",
        "A higher market-clearing price",
      ],
      correctIndex: 1,
      explanation:
        "At a price below equilibrium, consumers want to buy more than producers want to sell. Quantity demanded exceeds quantity supplied, creating a shortage.",
      conceptVariant: {
        question:
          "At a controlled rent of $600, 800 apartments are demanded but only 500 are supplied. What does this market experience?",
        options: [
          "A surplus of 300 apartments",
          "Equilibrium",
          "A shortage of 300 apartments",
          "A shortage of 1,300 apartments",
        ],
        correctIndex: 2,
        explanation:
          "The shortage equals quantity demanded minus quantity supplied: 800 − 500 = 300 apartments.",
      },
    },
    {
      id: "sunk-cost",
      question:
        "You paid $20 for a nonrefundable movie ticket. Before leaving, you realize you would enjoy staying home more. Which cost should you ignore when deciding?",
      options: [
        "The enjoyment of staying home",
        "The time spent traveling",
        "The $20 already paid",
        "The cost of transport to the cinema",
      ],
      correctIndex: 2,
      explanation:
        "The nonrefundable ticket is a sunk cost: it cannot be recovered either way. Base the decision on future costs and benefits that differ between your options.",
      conceptVariant: {
        question:
          "A business spent $5,000 developing a product. Launching now costs $2,000 and earns $3,000, with no other costs. What should it do?",
        options: [
          "Launch: the incremental benefit is $1,000",
          "Cancel: total costs exceed revenue",
          "Launch only if revenue exceeds $7,000",
          "Cancel because development costs are fixed",
        ],
        correctIndex: 0,
        explanation:
          "The $5,000 already spent is sunk. Launching adds $3,000 in revenue at $2,000 in extra cost, yielding an incremental gain of $1,000.",
      },
    },
    {
      id: "substitutes",
      question:
        "The price of tea rises, and demand for coffee increases. Based on this relationship, tea and coffee are…",
      options: [
        "Complements",
        "Inferior goods",
        "Unrelated goods",
        "Substitutes",
      ],
      correctIndex: 3,
      explanation:
        "Consumers switch toward coffee when tea becomes more expensive. Substitute goods have positive cross-price elasticity of demand.",
      conceptVariant: {
        question:
          "The price of butter rises by 10%, and demand for margarine rises by 5%. What is the cross-price elasticity?",
        options: ["−2", "+0.5", "−0.5", "+2"],
        correctIndex: 1,
        explanation:
          "Cross-price elasticity = 5% ÷ 10% = +0.5. The positive sign indicates that butter and margarine are substitutes.",
      },
    },
  ]),
  metadata: {
    elasticity: {
      topic: "Price elasticity",
      chapter: "Chapter 4",
      citation: "Demo study notes · §4.1 Price elasticity",
      rule: "$$|E_d| = \\left|\\frac{\\%\\Delta Q_d}{\\%\\Delta P}\\right|$$\nElastic when $|E_d| > 1$.",
    },
    "opportunity-cost": {
      topic: "Opportunity cost",
      chapter: "Chapter 1",
      citation: "Demo study notes · §1.2 Economic choices",
      rule: "Opportunity cost = value of the next-best alternative forgone.",
    },
    "price-ceiling": {
      topic: "Market equilibrium",
      chapter: "Chapter 3",
      citation: "Demo study notes · §3.2 Price controls",
      rule: "Binding ceiling < equilibrium price $\\implies Q_d > Q_s$ (shortage).",
    },
    "sunk-cost": {
      topic: "Decision-making",
      chapter: "Chapter 5",
      citation: "Demo study notes · §5.1 Relevant costs",
      rule: "Ignore unrecoverable past costs. Compare incremental benefits and costs.",
    },
    substitutes: {
      topic: "Related goods",
      chapter: "Chapter 4",
      citation: "Demo study notes · §4.3 Cross-price elasticity",
      rule: "$$E_{xy} = \\frac{\\%\\Delta Q_x}{\\%\\Delta P_y}$$\nPositive = substitutes; negative = complements.",
    },
  },
};

export const mockMicroeconomicsDoc: import("@/lib/schemas/ingestion").ParsedDocument = {
  fileName: "Microeconomics-Demo-Notes.txt",
  format: "txt",
  characterCount: 1850,
  pageCount: null,
  warnings: [],
  sources: [
    {
      id: "sec-1-2",
      label: "§1.2 Economic choices",
      text: "Opportunity cost is the value of the next-best alternative you give up when making a choice. For example, spending two hours studying instead of working a $30 tutoring job carries an opportunity cost of $30. Even with a free concert ticket, attending has an opportunity cost equal to the forgone work shift.",
    },
    {
      id: "sec-3-2",
      label: "§3.2 Price controls",
      text: "A binding price ceiling is set below the market equilibrium price. At this legal maximum price, consumers demand more units than producers are willing to supply, resulting in a market shortage. When rent control caps prices below equilibrium, quantity demanded exceeds quantity supplied.",
    },
    {
      id: "sec-4-1",
      label: "§4.1 Price elasticity",
      text: "Price elasticity of demand measures the responsiveness of quantity demanded to changes in price. It is defined as the absolute percentage change in quantity divided by the percentage change in price (|%ΔQ / %ΔP|). When this ratio is greater than 1, demand is elastic; when less than 1, demand is inelastic.",
    },
    {
      id: "sec-4-3",
      label: "§4.3 Cross-price elasticity",
      text: "Cross-price elasticity of demand measures how quantity demanded of one good responds to a price change in another good (%ΔQx / %ΔPy). A positive cross-price elasticity indicates substitute goods (such as coffee and tea, or butter and margarine), whereas a negative value indicates complementary goods.",
    },
    {
      id: "sec-5-1",
      label: "§5.1 Relevant costs",
      text: "Sunk costs are costs that have already been incurred and cannot be recovered by any future decision. Rational decision-makers ignore sunk costs and focus exclusively on incremental benefits and incremental costs going forward.",
    },
  ],
};
