import OpenAI from "openai";
import "dotenv/config";
import puppeteer from "puppeteer";

import fs from "fs";
import { Parser } from "json2csv";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function extractDomainWithoutCom(url) {
  try {
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;

    // Remove the top-level domain (TLD), assuming it's the part after the last dot
    return domain.split(".").slice(0, -1).join(".");
  } catch (error) {
    console.error("Invalid URL:", error.message);
    return null;
  }
}

// Helper function to delay execution
function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

// reviewFilter.js
// Function to extract and clean the review section
export async function extractReviewSection(page) {
  // Get the full page content (innerHTML of the body)
  let html = await page.evaluate(() => document.body.innerHTML);

  // Combine the patterns to match both possible review section variations
  let reviewSection = html.match(
    /<div class="(jdgm-widget (jdgm-review-widget|jdgm-all-reviews-widget) jdgm--done-setup-widget|yotpo-bold-layout yotpo-main-reviews-widget|okeReviews-reviewsWidget okeReviews-reviewsWidget--minimal js-okeReviews-reviewsWidget is-okeReviews-reviewsWidget-medium)">.*?<\/div>/s
  );

  // Log the extracted review section or a message if not found
  if (!reviewSection) {
    console.log("Review section not found with the specified patterns.");
  } else {
    console.log("Review Section:", reviewSection[0]);
  }

  // Use the matched review section or fallback to the full HTML if neither pattern matches
  html = reviewSection ? reviewSection[0] : html;

  // Remove unwanted tags (SVG, script, style, link) from the HTML
  html = html.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ""); // Remove SVG tags and their content
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ""); // Remove script tags and their content
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ""); // Remove style tags and their content
  html = html.replace(/<link[^>]*>[\s\S]*?<\/link>/gi, ""); // Remove link tags


// Remove extra whitespace (spaces, newlines, tabs) from the HTML
html = html.replace(/\s+/g, " ").trim();

console.log('Cleaned HTML:', html);  // Return the cleaned HTML


  return html;
}

// Function to extract reviews from the current page
export async function extractReviewsOnPage(page, container_ID, review_body) {
  console.log("Extracting reviews for container:", container_ID[0]);

  return await page.evaluate(
    (container_ID, review_body) => {
      console.log('`.${review_body?.review_title_class}`',`.${review_body?.review_title_class}`)
      const reviewElements = document.querySelectorAll(`.${container_ID}`);
      console.log("Found review elements:", reviewElements.length);

      // Map through the review elements and extract the details
      return Array.from(reviewElements).map((review) => ({
        rating:
          review
            .querySelector(`.${review_body?.review_rating_class}`)
            ?.getAttribute("data-score") || "N/A",
        author:
          review
            .querySelector(`.${review_body?.review_author_name_class}`)
            ?.innerText.trim() || "No Author",
        title:
          review
            .querySelector(`.${review_body?.review_title_class?.split(" ")?.[0]}`)
            ?.innerText.trim() || "No Title",
        description:
          review
            .querySelector(`.${review_body?.review_body_text_class}`)
            ?.innerText.trim() || "No Description",
      }));
    },
    container_ID,
    review_body
  );
}

// Function to check if there's a next page
export async function checkHasNextPage(page, pagination) {
  console.log("Checking if there is a next page...", pagination);

  return await page.evaluate((pagination) => {
    const nextButtonSelector = pagination?.next_page_class
      ? `.${pagination.next_page_class}`
      : `.${pagination.page_class.split(" ")?.[0]}`;

    const nextButton = document.querySelector(nextButtonSelector);
    console.log("nextButton", nextButton);
    return (
      nextButton &&
      !nextButton.classList.contains(pagination.page_class + "-inactive")
    );
  }, pagination);
}

async function mainScrapper(page, url) {
  await page.goto(url, {
    waitUntil: "networkidle0",
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Call the review section extraction function
  const html = await extractReviewSection(page);

  let classList = {};
  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "user",
        content: `Here is the HTML of some website: ${html}.

                  Review the HTML code and list out the selectors that are accompanied by the review section by properly segregating the selectors based on their use cases, i.e., main_review_section_container, review_header, review_stars, review_details, pagination, etc. 

                  If a specific selector is not found, return 'null' for that selector key while keeping the overall structure intact. 

                  If a section is completely missing, set it as 'null'.

                  Also, find out whether the review section consists of pagination or not. Set '"pagination_info": { "exists": false }' if pagination is not found.

                  Generate the response in the following format:

                  {
                    review_section: {
                      main_review_section_container: {
                        id: null, // Or id if found
                        class: null, // Or array of classes if found
                        'data-attributes': null // Or object with data attributes if found
                      } || null,
                      review_body: {
                        class: null,
                        reviews_class: null,
                        review_item_class: null,
                        review_content_class: null,
                        review_title_class: null,
                        review_body_text_class: null,
                        review_timestamp_class: null,
                        review_author_class: null,
                        review_author_name_class: null,
                        review_buyer_badge_class: null,
                        review_social_class: null,
                        review_votes_class: null,
                        review_rating_class: null
                      } || null,
                      pagination: {
                        pagination_class: null,
                        page_class: null,
                        current_page_class: null,
                        next_page_class: null,
                        last_page_class: null,
                        spinner_wrapper_class: null,
                        spinner_class: null
                      } || null
                    },
                    pagination_info: { exists: false } // Or true if found
                  }
                  `,
      },
    ],
    functions: [
      {
        name: "generateReviewResponseFormat",
        parameters: {
          type: "object",
          properties: {
            review_section: {
              type: "object",
              properties: {
                main_review_section_container: {
                  type: "object",
                  properties: {
                    id: { type: ["string", "null"] },
                    class: { type: ["array", "null"], items: { type: "string" } },
                    'data-attributes': { type: ["object", "null"] }
                  }
                },
                review_body: {
                  type: "object",
                  properties: {
                    class: { type: ["string", "null"] },
                    reviews_class: { type: ["string", "null"] },
                    review_item_class: { type: ["string", "null"] },
                    review_content_class: { type: ["string", "null"] },
                    review_title_class: { type: ["string", "null"] },
                    review_body_text_class: { type: ["string", "null"] },
                    review_timestamp_class: { type: ["string", "null"] },
                    review_author_class: { type: ["string", "null"] },
                    review_author_name_class: { type: ["string", "null"] },
                    review_buyer_badge_class: { type: ["string", "null"] },
                    review_social_class: { type: ["string", "null"] },
                    review_votes_class: { type: ["string", "null"] },
                    review_rating_class: { type: ["string", "null"] }
                  }
                },
                pagination: {
                  type: "object",
                  properties: {
                    pagination_class: { type: ["string", "null"] },
                    page_class: { type: ["string", "null"] },
                    current_page_class: { type: ["string", "null"] },
                    next_page_class: { type: ["string", "null"] },
                    last_page_class: { type: ["string", "null"] },
                    spinner_wrapper_class: { type: ["string", "null"] },
                    spinner_class: { type: ["string", "null"] }
                  }
                }
              }
            },
            pagination_info: {
              type: "object",
              properties: {
                exists: { type: "boolean" }
              }
            }
          }
        }
      }
    ],
    function_call: { name: "generateReviewResponseFormat" }
  });

  let jsonResponse = response.choices[0].message.content;
  // Clean up the response content to try and ensure valid JSON
  jsonResponse = jsonResponse
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .replace(/^[^{]*{/s, "{") // Removes text before the first {
    .replace(/}[^}]*$/s, "}"); // Removes text after the last }

  try {
    // Check if the cleaned response is valid JSON
    if (
      jsonResponse.charAt(0) === "{" &&
      jsonResponse.charAt(jsonResponse.length - 1) === "}"
    ) {
      classList = JSON.parse(jsonResponse);
      console.log("classList", classList);
      if (classList) {
        return await scrapeReviews(
          url,
          classList?.review_section,
          classList?.pagination_info
        );
      }
    } else {
      console.error("The cleaned response is not a valid JSON object.");
    }
  } catch (error) {
    console.error("Error parsing JSON response:", error);
  }
}

async function scrapeReviews(url, selectorsList, pagination_info) {
  const browser = await puppeteer.launch({ headless: false });

  try {
    const page = await browser.newPage();
    const { review_body, pagination } = selectorsList;
    const container_ID = review_body?.review_item_class?.split(" ");
    console.log("container_ID", container_ID);
    console.log("review_body", review_body);
    console.log("pagination", pagination);
    console.log("pagination_info", pagination_info);
    // Increase timeout for slow loading pages
    page.setDefaultNavigationTimeout(60000); // 60 seconds
    console.log(`Navigating to the page: ${url}`);
    await page.goto(url);

    let reviews = [];
    let hasNextPage = true;
    let pageNum = 1;

    while (hasNextPage) {
      console.log(`\n--------------------------`);
      console.log(`Scraping page ${pageNum}`);

      // Simulate pressing the 'Esc' key to close any popup dialogs
      try {
        console.log(
          `Attempting to press 'Esc' key to close any popup dialog...`
        );
        await page.keyboard.press("Escape");
        console.log(`'Esc' key pressed successfully.`);
      } catch (error) {
        console.log(
          `Failed to press 'Esc' key or no dialog found: ${error.message}`
        );
      }

      // Wait for the reviews to load
      try {
        console.log(`Waiting for the reviews section to load...`);
        await page.waitForSelector(`.${review_body?.reviews_class}`, {
          timeout: 60000,
        }); // 60 seconds
        console.log(`Reviews section loaded successfully.`);
      } catch (error) {
        console.log(`Error waiting for reviews section: ${error.message}`);
        break; // Exit the loop if reviews section fails to load
      }

      if (pagination?.next_page_class) {
        // Extract reviews from the current page
        console.log(`Extracting reviews from page ${pageNum}...`);
        // Extract reviews from the current page using the extractReviewsOnPage function
        const reviewsOnPage = await extractReviewsOnPage(
          page,
          container_ID,
          review_body
        );

        reviews = reviews.concat(reviewsOnPage);
        console.log(
          `Scraped ${reviewsOnPage.length} reviews from page ${pageNum}`
        );
      }

      // Check if there's a next page
      console.log(`Checking if there's a next page...`);
      // Check if there's a next page using the checkHasNextPage function
      hasNextPage = await checkHasNextPage(page, pagination);
      console.log("hasNextPage", hasNextPage);
      if (hasNextPage) {
        // Click the next page button
        try {
          console.log(`Navigating to the next page (page ${pageNum + 1})...`);
          const pageClass = pagination?.next_page_class
            ? `.${pagination?.next_page_class}`
            : `.${pagination?.page_class?.split(" ")?.[0]}`;
          await page.click(pageClass);

          // Wait for the reviews to load on the next page
          console.log(
            `Waiting for the next page (page ${pageNum + 1}) to load...`
          );
          await page.waitForSelector(`.${review_body?.reviews_class}`, {
            timeout: 60000,
          });

          await delay(3000); // Give extra time for content to load
          pageNum++;
          console.log(`Successfully navigated to page ${pageNum}.`);
        } catch (error) {
          if (!pagination?.next_page_class) {
            // Extract reviews from the current page
            console.log(`Extracting reviews from page ${pageNum}...`);
            // Extract reviews from the current page using the extractReviewsOnPage function
            const reviewsOnPage = await extractReviewsOnPage(
              page,
              container_ID,
              review_body
            );
    
            reviews = reviews.concat(reviewsOnPage);
            console.log(
              `Scraped ${reviewsOnPage.length} reviews from page ${pageNum}`
            );
          }
          console.log(`Error navigating to the next page: ${error.message}`);
          hasNextPage = false; // Stop if there's a navigation issue
          
        }
      } else {
        if (!pagination?.next_page_class) {
          // Extract reviews from the current page
          console.log(`Extracting reviews from page ${pageNum}...`);
          // Extract reviews from the current page using the extractReviewsOnPage function
          const reviewsOnPage = await extractReviewsOnPage(
            page,
            container_ID,
            review_body
          );
  
          reviews = reviews.concat(reviewsOnPage);
          console.log(
            `Scraped ${reviewsOnPage.length} reviews from page ${pageNum}`
          );
        }
  
        console.log(`No more pages or last page reached.`);
      }
    }

    // if (!pagination?.next_page_class) {
    //   // Extract reviews from the current page
    //   console.log(`Extracting reviews from page ${pageNum}...`);
    //   // Extract reviews from the current page using the extractReviewsOnPage function
    //   const reviewsOnPage = await extractReviewsOnPage(
    //     page,
    //     container_ID,
    //     review_body
    //   );

    //   reviews = reviews.concat(reviewsOnPage);
    //   console.log(
    //     `Scraped ${reviewsOnPage.length} reviews from page ${pageNum}`
    //   );
    // }
    console.log(`Closing the browser...`);

    return reviews;
  } catch (error) {
    console.log("Error Occured :", error);
  } finally {
    // await browser.close();
  }
}


async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-features=site-per-process",
    ],
    defaultViewport: null,
  });
  const page = await browser.newPage();
  const url =
    "https://milky-mama.com/pages/customer-reviews";

  try {
    const reviews = await mainScrapper(page, url);
    // const reviews = await scrapeReviews(
    //   url,
    //   classList?.review_section,
    //   classList?.pagination_info
    // );
    await browser.close();
    console.log(`Total reviews scraped: ${reviews.length}`);
    // Convert to CSV and save to file
    const fields = ["rating", "author", "title", "description"];
    const parser = new Parser({ fields });
    const csv = parser.parse(reviews);

    const filename = extractDomainWithoutCom(url);
    fs.writeFileSync(`${filename}.csv`, csv);
    console.log(`Scraped reviews saved to ${filename}.csv`);
  } catch (error) {
    console.error("Error during scraping:", error);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

main().catch(console.error);
