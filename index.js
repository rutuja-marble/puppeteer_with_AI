import OpenAI from "openai";
import "dotenv/config";
import puppeteer from 'puppeteer'


const openai = new OpenAI({
    apiKey:process.env.OPENAI_API_KEY
});

async function scrapper(){

    // await puppeteer.connect({})
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox','--disable-features=site-per-process'],
        defaultViewport: null,

      });
      const page = await browser.newPage();

      await page.goto('https://milky-mama.com/pages/customer-reviews',{ waitUntil:"networkidle0"});
      await new Promise((resolve)=>setTimeout(resolve,1000));

    // const html= await page.content();
    // console.log('html',html)
    let html = await page.evaluate(() => document.body.innerHTML);

// Combine the patterns to match both possible review section variations
let reviewSection =   html.match(
  /<div class="jdgm-widget (jdgm-review-widget|jdgm-all-reviews-widget) jdgm--done-setup-widget">.*?<\/div>/s
);

// Log the extracted review section or a message if not found
if (!reviewSection) {
  console.log("Review section not found with the specified patterns.");
} else {
  console.log("Review Section:", reviewSection[0]);
}


// Use the matched review section or fallback to the full HTML if neither pattern matches
     html = reviewSection ? reviewSection[0] : html; // Use the limited HTML or fallback to full HTML
    html = html.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ''); // Removes all SVG tags and their content
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ""); // Removes all script tags and their content
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ""); // Removes all style tags and their content
  html = html.replace(/<link[^>]*>[\s\S]*?<\/link>/gi, ""); // Removes all script tags and their content

    let classList = {};
    await browser.close()
   const response =  await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                "role": "user",
                "content": `Here is the HTML of some website: ${html}.

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
      review_votes_class: null
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
`
            }
        ]
    })
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
      } else {
        console.error("The cleaned response is not a valid JSON object.");
      }
    } catch (error) {
      console.error("Error parsing JSON response:", error);
    }
  
    console.log("classList", classList);
}

scrapper()