import OpenAI from "openai";
import "dotenv/config";
import puppeteer from "puppeteer";

import fs from 'fs';
import { Parser } from 'json2csv';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper function to delay execution
function delay(time) {
  return new Promise(function(resolve) { 
    setTimeout(resolve, time);
  });
}

async function scrapper() {
  // await puppeteer.connect({})
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
  const url = "https://2717recovery.com/products/recovery-cream";
  await page.goto(url, {
    waitUntil: "networkidle0",
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // const html= await page.content();
  // console.log('html',html)
  let html = await page.evaluate(() => document.body.innerHTML);

  // Combine the patterns to match both possible review section variations
  let reviewSection = html.match(
    /<div class="(jdgm-widget (jdgm-review-widget|jdgm-all-reviews-widget) jdgm--done-setup-widget|yotpo-bold-layout yotpo-main-reviews-widget)">.*?<\/div>/s
  );
  // Log the extracted review section or a message if not found
  if (!reviewSection) {
    console.log("Review section not found with the specified patterns.");
  } else {
    console.log("Review Section:", reviewSection[0]);
  }

  // Use the matched review section or fallback to the full HTML if neither pattern matches
  html = reviewSection ? reviewSection[0] : html; // Use the limited HTML or fallback to full HTML
  html = html.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ""); // Removes all SVG tags and their content
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ""); // Removes all script tags and their content
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ""); // Removes all style tags and their content
  html = html.replace(/<link[^>]*>[\s\S]*?<\/link>/gi, ""); // Removes all script tags and their content

  let classList = {};
  await browser.close();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
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
    review_header: {
      class: null,
      title_class: null,
      subtitle_class: null,
      summary_inner_class: null,
      stars_class: null,
      average_class: null,
      text_class: null,
      link_class: null
    } || null,
    review_histogram: {
      histogram_class: null,
      histogram_row_class: null,
      star_class: null,
      bar_class: null,
      bar_content_class: null,
      frequency_class: null,
      clear_filter_class: null
    } || null,
    review_actions: {
      actions_wrapper_class: null,
      write_review_button_class: null
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
  });
  let jsonResponse = response.choices[0].message.content;
  // Clean up the response content to try and ensure valid JSON
  jsonResponse = jsonResponse
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .replace(/^[^{]*{/s, "{") // Removes text before the first {
    .replace(/}[^}]*$/s, "}"); // Removes text after the last }

  // let classList = {};
  try {
    // Check if the cleaned response is valid JSON
    if (
      jsonResponse.charAt(0) === "{" &&
      jsonResponse.charAt(jsonResponse.length - 1) === "}"
    ) {
      classList = JSON.parse(jsonResponse);
      if(classList){
       const reviews = await  scrapeReviews(url, classList?.review_section, classList?.pagination_info)
       
       console.log(`Total reviews scraped: ${reviews.length}`);

  // Convert to CSV and save to file
  const fields = ['rating', 'author', 'title', 'description'];
  const parser = new Parser({ fields });
  const csv = parser.parse(reviews);

  fs.writeFileSync('judgeMeReviews.csv', csv);
  console.log(`Scraped reviews saved to reviews.csv`);
      }
    } else {
      console.error("The cleaned response is not a valid JSON object.");
    }
  } catch (error) {
    console.error("Error parsing JSON response:", error);
  }

}

scrapper();




async function scrapeReviews(url, selectorsList,pagination_info) {

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  const{review_body,pagination} = selectorsList;
  const container_ID = selectorsList?.review_body?.review_item_class?.split(" ")
  console.log('container_ID',container_ID)
  // Increase timeout for slow loading pages
  await page.setDefaultNavigationTimeout(60000); // 60 seconds
  console.log(`Navigating to the page: ${url}`);
  await page.goto(url);

  let reviews = [];
  let hasNextPage = true;
  let pageNum = 1;

  while (hasNextPage && pageNum<6) {
    console.log(`\n--------------------------`);
    console.log(`Scraping page ${pageNum}`);

    // Simulate pressing the 'Esc' key to close any popup dialogs
    try {
      console.log(`Attempting to press 'Esc' key to close any popup dialog...`);
      await page.keyboard.press('Escape');
      console.log(`'Esc' key pressed successfully.`);
    } catch (error) {
      console.log(`Failed to press 'Esc' key or no dialog found: ${error.message}`);
    }

    // Wait for the reviews to load
    try {
      console.log(`Waiting for the reviews section to load...`);
      await page.waitForSelector('.jdgm-rev-widg__reviews', { timeout: 60000 }); // 60 seconds
      console.log(`Reviews section loaded successfully.`);
    } catch (error) {
      console.log(`Error waiting for reviews section: ${error.message}`);
      break; // Exit the loop if reviews section fails to load
    }

    // Extract reviews from the current page
    console.log(`Extracting reviews from page ${pageNum}...`);
   // Pass container_ID as an argument to page.evaluate
   const reviewsOnPage = await page.evaluate((container_ID, review_body) => {
    console.log('container_ID',container_ID[0], typeof(container_ID))
    const reviewElements = document.querySelectorAll(`.${container_ID}`);
    console.log('reviewElements',reviewElements)
    console.log(`.${review_body?.review_rating_class}`,`.${review_body?.review_author_name_class}`)
    return Array.from(reviewElements).map(review => ({
      rating: review.querySelector(`.${review_body?.review_rating_class}`)?.getAttribute('data-score') || 'N/A',
      author: review.querySelector(`.${review_body?.review_author_name_class}`)?.innerText.trim() || 'No Author',
      title: review.querySelector(`.${review_body?.review_title_class}`)?.innerText.trim() || 'No Title',
      description: review.querySelector(`.${review_body?.review_body_text_class}`)?.innerText.trim() || 'No Description'
    }));

  }, container_ID, review_body);  // Pass container_ID and selectorsList here
  
    reviews = reviews.concat(reviewsOnPage);
    console.log(`Scraped ${reviewsOnPage.length} reviews from page ${pageNum}`);

    // Check if there's a next page
    console.log(`Checking if there's a next page...`);
     hasNextPage = await page.evaluate((pagination) => {
      const nextButton = document.querySelector(`.${pagination?.next_page_class}`);
      return nextButton && !nextButton.classList.contains(pagination?.page_class + '-inactive');
    }, pagination);
    

    if (hasNextPage) {
      // Click the next page button
      try {
        console.log(`Navigating to the next page (page ${pageNum + 1})...`);
        await page.click('.jdgm-paginate__next-page');
        
        // Wait for the reviews to load on the next page
        console.log(`Waiting for the next page (page ${pageNum + 1}) to load...`);
        await page.waitForSelector('.jdgm-rev-widg__reviews', { timeout: 60000 });
        
        await delay(3000); // Give extra time for content to load
        pageNum++;
        console.log(`Successfully navigated to page ${pageNum}.`);
      } catch (error) {
        console.log(`Error navigating to the next page: ${error.message}`);
        hasNextPage = false; // Stop if there's a navigation issue
      }
    } else {
      console.log(`No more pages or last page reached.`);
    }
  }

  console.log(`Closing the browser...`);
  await browser.close();
  return reviews;
}


