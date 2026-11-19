// Canned responses used when WRITING_MOCK=1, so the UI can be exercised without calling Claude.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mockTest(module) {
  await wait(1200);
  if (module === "general") {
    return {
      title: "Neighbour noise & public libraries",
      task1: {
        prompt: "You recently moved into a new flat, and your neighbour often plays loud music late at night. Write a letter to your neighbour.",
        bullets: ["introduce yourself", "explain how the noise is affecting you", "suggest a solution"],
        letterOpening: "Dear ...,",
      },
      task2: {
        statement: "Some people believe that public libraries are no longer necessary because information is available online.",
        question: "To what extent do you agree or disagree?",
        essayType: "opinion",
      },
    };
  }
  return {
    title: "Cycling commuters & four-day work week",
    task1: {
      prompt: "The line graph below shows the percentage of commuters who cycled to work in four European cities between 2000 and 2020, and the pie chart shows the main reasons given for cycling in 2020.",
      visuals: [
        {
          type: "line", title: "Commuters cycling to work (%)", xLabel: "Year", yLabel: "%", unit: "%",
          categories: ["2000", "2005", "2010", "2015", "2020"],
          series: [
            { name: "Copenhagen", values: [32, 35, 37, 41, 49] },
            { name: "Berlin", values: [10, 12, 13, 15, 18] },
            { name: "Paris", values: [2, 3, 5, 9, 15] },
            { name: "Madrid", values: [1, 1, 2, 2, 4] },
          ],
        },
        {
          type: "pie", title: "Main reason for cycling, 2020", unit: "%",
          categories: ["Speed", "Cost", "Health", "Environment", "Other"],
          series: [{ name: "2020", values: [34, 22, 21, 17, 6] }],
        },
      ],
    },
    task2: {
      statement: "Some companies have introduced a four-day working week without reducing employees' pay.",
      question: "Do the advantages of this outweigh the disadvantages?",
      essayType: "advantages-disadvantages",
    },
  };
}

export async function mockGrade() {
  await wait(1500);
  const crit = (name, band) => ({ name, band, summary: `${name}: mock assessment.`, strengths: ["Mock strength"], weaknesses: ["Mock weakness"] });
  return {
    examinerComment: "Mock examiner comment. Run without WRITING_MOCK to get real feedback from Claude.",
    tasks: [1, 2].map((task) => ({
      task,
      overview: "Mock overview of this task.",
      criteria: [crit(task === 1 ? "Task Achievement" : "Task Response", 6), crit("Coherence and Cohesion", 6), crit("Lexical Resource", 7), crit("Grammatical Range and Accuracy", 6)],
      annotations: [{ quote: "the", criterion: "GRA", severity: "minor", issue: "Mock issue on an article.", fix: "a" }],
      improvedVersion: "Mock improved version.",
    })),
    priorities: [{ title: "Write a clear overview", detail: "Mock priority detail.", criterion: "TA", practice: "Write 5 overviews in 3 minutes each." }],
  };
}
