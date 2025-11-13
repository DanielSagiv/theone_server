v4_gxn
Global Experience Network (GXN) API Collection
A unified suite of RESTful endpoints for managing all guest‑facing operations—inventory, holds, bookings and refunds—across your entire property portfolio. Every call requires the same three credentials (apikey, sourcecode, sourceloc) and, to streamline integration, there are no enforced rate limits on any key.

Authentication
An API key is required to access the GXN APIs. This key:

Grants access to specific venues and their associated data.

Is passed via query string.

Has no rate limits, allowing unrestricted access for approved partners.

sourcecode and sourceloc (Context of Access)
These identify how and from where the API is accessed:

sourcecode	Description	sourceloc (Expected Value)
public	Access from a public-facing website	Domain/URL
network	Reseller or partner network access	TBD by Reseller
private	Access from a private or internal source	Domain/URL
kiosk	Access from a physical kiosk	Kiosk Name
microsite	Access from a specialized microsite	Microcode
Inventory
The GXN Inventory APIs enable rich querying and filtering of available experiences across venues, inventory items, schedules, and performers. It supports both venue-centric and theme-based discovery through parameters such as tokens, sourcecode, sourceloc, caldate, todate, and venuecode.

Response Structure
json
"data": {
  "header": {...},
  "inventory": {...},
  "items": {...},
  "venues": {...},
  "schedules": {...},
}
Each node provides a layer of context, ranging from metadata (header) to detailed inventory and venue information.

Key Parameters for Filtering
tokens (Tag-Based Filtering)
Tags enable thematic organization of inventory, such as "Adventure", "Dining", or "Wellness". Tags are returned in the header node as IDs like TAG123.

Usage Example:

tokens=TAG123,TAG456

caldate and todate (Date Filtering)
caldate: Required. Start date in YYYY-MM-DD format.

todate: Optional. End date to define a range

Example:

caldate=2025-06-01&todate=2025-06-15

venuecode (Venue-Specific Filtering)
Use to filter down to a specific venue. Format: VEN##### (e.g., VEN134713).

Example:

venuecode=VEN134713

Combining Parameters for Powerful Discovery
You can combine multiple parameters in a single query:

?tokens=TAG101,TAG202&caldate=2025-07-01&todate=2025-07-07&venuecode=VEN134713

Summary
By combining:

tokens for themes,

sourcecode + sourceloc for origin tracking,

caldate + todate for availability windows,

venuecode for focused queries, and

an unrestricted API key

…you unlock a fully dynamic, interest-driven inventory search experience ideal for modern travel, events, and hospitality platforms.

GET
inventory
https://apiuat.urvenue.me/v4/gxn/inventory/json/?apikey=&sourcecode=test&sourceloc=postman&caldate=&venuecode=VEN505115
Overview
Core Features of the Inventory API:

The "Inventory" API organizes inventory into a hierarchical structure based on tags. These tags represent various themes or categories of experiences, such as adventure, relaxation, dining, entertainment, etc., making it easier for users to browse and select based on their interests.

Flexible Query Parameters: The "Inventory" API accepts a wide range of parameters that allow users to customize their search. These parameters can include date ranges, specific tags or categories of interest, and other filters that help narrow down the search results to match user preferences.

Comprehensive Output: The output provided by the "Inventory" API mirrors the detailed structure found in the "Inventory" API, offering rich information that includes not just the inventory under each tag but also additional details such as event dates, pricing, stock levels, and related venue profiles. This ensures that users have all the necessary information to make informed decisions.

Optimized for User Experience: Organizing inventory by both tags and venues can significantly enhance the user experience, especially in regions or contexts where the type of activity or experience is more important than the specific location. This approach facilitates a more intuitive and thematic exploration of available options.

Use Cases
Regional Showcases: When promoting tourism or events within a particular region, the "Inventory" API allows organizers to highlight the diversity of experiences available, encouraging exploration based on interests rather than venue loyalty.

Thematic Campaigns: For marketing campaigns focused on specific themes (e.g., summer adventures, winter retreats, cultural festivals), this API can dynamically group and present inventory aligned with the campaign's theme.

Personalized Recommendations: Platforms that aim to offer personalized activity or experience recommendations can leverage the "Inventory" API to curate selections based on user preferences or past behavior, emphasizing the type of experience over the venue.

Integration Considerations:
When integrating the "Inventory" API, it's crucial to consider the user journey and how thematic exploration can be seamlessly incorporated into the platform's UI/UX. Given the API's flexible parameters and detailed output, developers have the freedom to craft tailored exploration experiences that prioritize user interests and enhance engagement.

Additionally, while the "Inventory" API provides a comprehensive overview based on thematic tags, integrating with other GXN APIs for more focused queries or live data might still be necessary, depending on the application's scope and requirements. This holistic approach ensures that users not only discover experiences that resonate with their interests but also access the most current and detailed information to facilitate their decisions.

Base API URL
Plain Text
https://apiuat.urvenue.me/v4/gxn/inventory/json/
Inventory API Request Body Parameters:
Key	Required	Description
"caldate"	Yes	The date for which inventory information is requested. Format: "YYYY-MM-DD"
"todate"	No	End date of the date range if querying for a range of dates.
"apikey"	Yes	Your API key for authentication purposes.
"sourcecode"	Yes	Code representing the source of the inventory information.
"sourceloc"	Yes	Code representing the source location.
"ecozone"	No	Used to get inventory from a specific ecozone.
"tokens"	No	Used to filter the response.
"filters"	No	Used to grab certain venues, market areas, geolocations or tags.
The Filters feature within our API offers users precise control over the data they retrieve, allowing for tailored and focused results. With a variety of filter options available, users can refine their queries to match specific criteria, ensuring the information they receive is relevant to their needs. "&filters={filter1|filter2....}"

Global Types: This filter enables users to specify whether they want to include items with a global type item in their results. By default, items with global types are included, but users can use the "noglobaltypes" parameter to exclude them if necessary or only include them with "globaltypes". "&filters=noglobaltypes" or "&filters=globaltypes"

Item Types: Similar to the Global Types filter, the Item Types filter allows users to filter items based on their item type. By default, items with item types are included, but users can use the "noitemtypes" parameter to exclude them from the results or only include them with "itemtypes".

Data Format: This filter provides users with options to customize the format of the data returned by the API call. Users can choose one from three options:

"light": This option simplifies the response by providing only essential data, reducing the volume of information returned. Used as "&filters=data:light"

"schedule": When selected, this option removes the inventory node from the response and includes only the "Schedule Node" and the "Venues Node" streamlining the data for scheduling purposes. Used as '&filter=data:schedule'

"events": Selecting this option will limit the response to only display the "Venues node," ideal for scenarios where only event-related data is required. Used as "&filtes=data:events"

Multiple Filters
Users can combine multiple filters to further refine their queries by using the pipe "|" between each filter. This flexibility allows for precise control over the data retrieved, ensuring that users receive the most relevant information for their needs.

Example: "&filters=data:light|itemtypes"

The Tokens feature within our API enables users to specify particular identifiers of interest, ensuring that the retrieved data is precisely tailored to their needs. By incorporating various token options, users can focus their queries on specific venues, market areas, geolocations, or tags, facilitating efficient data retrieval. "&tokens={token1,token2....}"

Venues: This option filters the data to display only information related to the specified venue tokens. Users can include one or more venue tokens, separated by commas, to narrow down the results. For example, specifying "VEN000000" would retrieve data exclusively related to the venue with the identifier VEN000000. "&tokens=VEN0000000,VEN000001"

Market Areas: When selecting this filter, users can restrict the returned data to only include information related to the specified market area tokens. By including one or more market area tokens separated by commas, users can focus their query on specific market areas of interest. For instance, adding "MKA0000" would retrieve data solely related to the market area with the identifier MKA0000. "&tokens=MKA0000,MKA0001"

Geolocation: This filter allows users to retrieve data for venues located near a given geographical location. Users can specify the latitude, longitude, distance, and optional units parameter to refine their query. For example, using the format "LOC{LAT|LON|DISTANCE|UNITS(optional)}", users can retrieve venues near a specific location based on their distance criteria. Ex. "&tokens=LOC36.1716|36.1341|100|km"

Multiple Tokens
By combining these token options and incorporating them into their queries, users can efficiently retrieve relevant data tailored to their specific requirements, enhancing their overall experience with the API. "&tokens=MKA0001,TAG0000,LOC40.730610|-73.935242|20|miles"

Example API Call:

View More
Plain Text
https://apiuat.urvenue.me/v4/gxn/inventory/json/?apikey={APIKEY}&sourcecode={SOURCECODE}&sourceloc={SOURCELOC}&caldate=2024-07-04&todate2024-07-11&ecozone=4&filters=data:light|itemtypes&tokens=MKA0001,LOC40.730610|-73.935242|20|miles
API Response
We will look at the structure of the response going node by node and going through every field. Below is the basic structure of the response and a brief description of each major node.

View More
Plain Text
{
    "success": 1,
    "http_code": 200,
    "message": "success",
        "data": {
            "header": {...},
            "inventory": {...},
            "items": {...},
            "venues": {...},
            "schedules": {...},
        }
    }
}
Note: some nodes will not appear if no data is available for that particular node.

Header: Essential metadata for the inventory system. It includes details such as the identification numbers for the ecozone and partner, the partner's name, and their type or role within the system.

Inventory: Displays a list items available per venue and tags that are associated to a particular item.

Items: Displays the items available along with their attributes.

Venues: This node serves as a comprehensive repository of information about individual venues.

Schedules: This node serves to organize and manage the scheduling and events for various venues.

NOTE: Before we dive into the response, nodes with uppercase letters and numbers are codes in which case there could be multiple nodes on the same level. Below is an example.

json
"venues": {
    "VEN001": {
        "MAS010": {...},
        "MAS011": {...},
        "MAS100": {...}
    },
    "VEN002":{...},
    "VEN003":{...},
    "VEN004":{...}
}
Header Node
View More
json
"header": {
    "location": {
        "latitude": "40.730610",
        "longitude": "-73.935242",
        "distance": "20",
        "unit": "miles"
    },
    "eaccountid": null,
    "partnerid": null,
    "partnername": null,
    "partnertype": null,
    "caldate": "2024-03-20",
    "todate": "2024-03-20",
    "venuecodes": [
        "VEN000000"
    ],
    "tokens": [
        "MKA0001",
        "TAG0000",
        "LOC40.730610|-73.935242|20|miles"
    ],
    "times": "item",
    "guestsearch": "none",
    "guestrequired": "no",
    "engine": "pay",
    "tags": {
      "TAG1042": {
        "label": "Indoor"
      },
      "TAG1044": {
        "label": "Outdoor"
      },
      "TAG10242": {...},
      "TAG10243": {...},
      "TAG10247": {...},
      "TAG10248": {...},
      "TAG10254": {...},
    }
},
"location" : Used to search near the location given for venues in the area with a given radius.

"latitude": Latitude of the point from the LOC token. Ex. "40.730610"

"longitude": Latitude of the point from the LOC token. Ex. "-73.935242"

"distance": The radius length from the latitude and longitude. Ex. "20"

"unit": Unit of the the distance. Either "miles" or "km"(kilometers). Ex. "miles"

"eaccountid": The identification number for the current ecozone.

"partnerid": The identification number for the current partner.

"partnername": Name of the partner.

"partnertype": Denotes the category of the partner using the system for selling inventory. It categorizes partners into roles like resellers, affiliates, etc.

"caldate": Calendar date the item is available on. Formatted as: "YYYY-MM-DD".

"todate": (Optional) to be used to fetch from a date range. Formatted as: "YYYY-MM-DD" and will default to "caldate" if not provided.

"venuecodes": Unique code specific to the venue that the inventory items belong to. Presented in the following format: "VEN000000".

"tokens": Denotes the makes use of tokens to narrow down to certain information. Such as the market area, Las Vegas' market area code is MKA446. For more information see above detailing tokens further.

"times": Displays time mode used for venue.

"guestsearch": Indicates if API key requires a guest search before booking inventory.

"engine": Indicates the payment engine being used.

"tags": An array of all tags that are used in the inventory. Organized by "tagid" and with a "label" being the the tag name.

Inventory Node
json
"inventory": {
  "D000000": {
    "venues": {...},
    "tree": {...},
    "tags": {...}
  }
}
This is the main node housing inventory information. The three main subcomponents of this node are:

"venues": Venue details, broken up by venue IDs.

"tree": Node highlighting relationship between Inventory items and venues

"tags": Displays the tag hierarchy and linked items to specific tags.

Inventory :: Venues Sub-Node
View More
json
"venues": {
  "VEN000000": {
    "ecozones": {
      "ECZ000": {
        "items": [
          "MDKSLEKDB0A",
          "MMLSKFDFB0A",
        ],
        "eczinfo": {
          "ecozone": 0,
          "name": "Default",
          "venuecode": "VEN000000",
          "starttime": null,
          "endtime": null
        }
      }
    },
    "ecolist": {...},
    "masterlist": {...}
  },
  "VEN000000": {...},
},
"venues" -> {"venuecode"} -> "ecozones"-> {"ecocode"}

"items": Lists mastercodes of items available.

"eczinfo" =>

"ecozone": Ex. 0

"name": Name of the ecozone. Default value "Default"

"venuecode": Unique code specific to the venue that the items belong to. Presented in the following format: VEN000000.

"starttime": Denotes the start time of the event (24-hour format).

"endtime": Denotes the end time of the event (24-hour format).

Inventory -> Venues Sub-Node -> Ecolist Sub-Node
View More
json
"ecolist": [
    {
    "ecomasters": {
      "MAS000000": {
        "ecoitems": {
          "ECZ000": "MTQQKYUPM0A",
          "ECZ001": "MTQQKYUPM0B",
        }
      },
      "MAS000001": {...},
      "MAS000002": {...},
    },
    "booktype": {
      "nodetype": "Booktype",
      "label": "Cabanas",
      "descr": "",
      "icon": ""
    }
  },
  {...},
  {...}
]
"ecolist" -> [array_index] -> "ecomasters" -> {"masteritemcode"} => "ecoitems" ->{"ecocode"}: Shows the mastercodes for each ecozone.

"ecolist"->[array_index] -> "booktype"

"nodetype": Field to indicate what type of item is being dealt with with.Ex. "Booktype".

"label": A short one word label for the item. Ex. "Book".

"descr": Optional item description field.

"icon": This is the name of the icon for the nodetype.

Inventory => Venues Sub-Node => Masterlist Sub-Node
View More
json
"masterlist": {
  "MAS000000": {
    "ecoitems": {
      "ECZ000": "MTQQKYUPM0A",
      "ECZ001": "MTQQKYUPM0B",
    },
    "mastername": "Premium Party Cabanas",
    "masterhighlight": "Please refer to the item description for additional reservation details, including your food & beverage minimum which is due upon arrival in addition to your prepaid rental fee"
  },
  "MAS000001": {...},
  "MAS000002": {...},
"masterlist" -> {"masteritemcode"} -> "ecoitems"

{"ecocode"}: Shows the mastercodes for each ecozone.

"mastername": Name of the master item.

"masterhighlight": Short item highlight describing the masteritem.

Inventory -> Tree Sub-Node
View More
json
"tree": {
   "nodes": [
        {
          "nodes": [
            {
              "nodes": [
                {
                 "masteritems": {
                    "venuecode": "VEN1322227",
                    "ecocode": "ECZ000",
                    "caldate": "2024-04-27",
                    "layoutcode": "LAY0",
                    "idate": "D240427",
                    "mastercodes": [
                      "MPQJXQFFN0A",
                      "MBVIHBUGN0A"
                    ]
                  },
                  "minprice": 0,
                  "maxprice": 0,
                  "mintime": "10900",
                  "maxtime": "11600",
                  "nodetype": "Booktype",
                  "nodecode": "BKT000000",
                  "level": 5,
                  "label": "",
                  "highlight": null,
                  "icon": "",
                  "logos": null,
                  "images": [
                    {
                      "folder": "FOLDERPATH",
                      "file": "yourimage.jpeg"
                    }
                  ],
                  "descr": null,
                  "leaf": true,
                  "nodes": null,
                },
                {...}
              ],
              "nodetype": "Venue",
              "nodecode": "VEN000000",
              "level": 3,
              "label": "",
              "highlight": "",
              "icon": null,
              "images": [
                {
                  "folder": "FOLDERPATH",
                  "file": "yourimage.jpeg"
                }
              ],
              "descr": null,
              "minprice": 0,
              "maxprice": 0,
              "mintime": "10900",
              "maxtime": "11600"
            },
            {...},
          ],
          "nodetype": "Venue",
          "nodecode": "VEN000000",
          "level": 1,
          "label": "Resort Activities",
          "highlight": "",
          "icon": null,
          "images": [
            {
              "folder": "FOLDERPATH",
              "file": "yourimage.jpeg"
            }
          ],
          "descr": null,
          "minprice": 0,
          "maxprice": 0,
          "mintime": "0",
          "maxtime": "11645"
        },
        {...},
   ]
}
"node":

"masteritems" :

"venuecode": Unique code specific to the venue that the items belong to. Presented in the following format: VEN000000.

"ecocode": Code to represent the ecozone that the item belongs to. Presented in the following format: "ECZ000".

"caldate": Calendar date that the inventory item can begin being shown. Format: "YYYY-MM-DD"

"layoutcode": Specific code for the layout of the items. Ex "LAY0"

"idate": Date that the item is available. Shown in the format “DYYMMDD”.

"mastercodes": Lists mastercodes in a particular venue.

"minprice": Minimum price of the item.

"maxprice": Maximum price of the item.

"mintime": Optional field. Can be used in combination with "maxtime" to set a time slot for the inventory item. Default value: "0". Ex. "10900"

"maxtime": Optional field. Can be used in combination with "mintime" to set a time slot for the inventory item. Default value "0". Ex. "11600"

"nodetype": Field to indicate what type of item is being dealt with with.Ex. "Booktype"

"nodecode": Unique code. Presented in the following format: "BKT00000", "VEN000000", "TAG0024".

"level": Integer value that represents the level of the current node with regards to other nodes in the tree.

"label": A short one word label for the item. Ex. "Book"

"highlight": Short item highlight describing the item.

"icon": This is the name of the icon for the nodetype.

"logos": Similar to the "images" sub-node in structure below.

"descr": Optional item description field.

"leaf": Whether this is node a leaf node.

"images" ->

"folder": Folder identifier where an image is being pulled from. (Used with "subfolder". If applicable)

"file": Name of file in the following format: "000000.FILETYPE".

"nodetype": Field to indicate what type of item is being dealt with with. Ex. "Booktype"

"nodecode": Unique code. Presented in the following format: "BKT00000", "VEN000000", "TAG0024".

"level": Integer value that represents the level of the current node with regards to other nodes in the tree.

"label": A short one word label for the item. Ex. "Book"

"highlight": Short item highlight describing the location.

"icon": This is the name of the icon for the nodetype

"images"->

"folder": Folder identifier where an image is being pulled from. (Used with "subfolder". If applicable)

"file": Name of file in the following format: "000000.FILETYPE".

"descr": Optional item description field

"minprice": Minimum price of the item.

"maxprice": Maximum price of the item.

"mintime": Optional field. Can be used in combination with "maxtime" to set a time slot for the inventory item. Default value: "0". Ex. "10900"

"maxtime": Optional field. Can be used in combination with "mintime" to set a time slot for the inventory item. Default value "0". Ex. "11600"

Inventory -> Tags Sub-Node
View More
json
"tags": {
  "TAG10000": {
    "nodes": {
      "BKT101747": {
        "items": {
          "MPQJXQFFN0A": {
            "mastercode": "MPQJXQFFN0A",
            "itemname": "UrVenue Nightclub",
            "venuecode": "VEN0000000",
            "ecocode": "ECZ000",
            "idate": "D240427",
            "masteritemcode": "MAS100000",
            "ecokey": "ECZ000D2404271322227",
            "label": "UrVenue Club"
          },
          "MRDPMLBFN0A": {...},
          "MDCBWGAFN0A": {...},
          "MHWGYPJGN0A": {...}
        },
        "nodetype": "Booktype",
        "label": "Food & Beverage",
        "descr": "Enjoy our premium nightclub tables",
        "images": [...],
        "minprice": null,
        "maxprice": null,
        "mintime": null,
        "maxtime": null
      }
    },
    "nodetype": "Tag",
    "label": "Dining & Food",
    "nodecode": "TAG10000",
    "images": [
      {
        "folder": "FOLDER PATH",
        "file": "0001.jpeg"
      }
    ]
  },
  "TAG10001": {...},
  "TAG10002": {...},
}
"tags" => {"tag"} => "nodes" => {"booktypecode"}

"items" => {"mastercode"} =>

"mastercode": Unique code specific to the item. Ex. MSABCDEF0N

"itemname": Name for the specific item. Ex "Scooter Rental"

"venuecode": Unique code specific to the venue that the items belong to. Presented in the following format: VEN000000.

"ecocode": Code to represent the ecozone that the item belongs to. Presented in the following format: "ECZ000".

"idate": Date that the item is available. Shown in the format “DYYMMDD”.

"masteritemcode": Unique code identifier for the master item within inventory. Presented in the following format: "MAS00000". This is the code that will need to be returned to Booketing when an item is booked so that it can be removed from inventory.

"ecokey": A key combining the "ecocode", "idate" and "venueid". Format: {"ecocode"}{"idate"}{"venueid"}

"label": A short one word label for the item. Ex. "Book"

"nodetype": Field to indicate what type of item is being dealt with with.Ex. "Booktype"

"minprice": Minimum price of the item.

"maxprice": Maximum price of the item.

"mintime": Optional field. Can be used in combination with "maxtime" to set a time slot for the inventory item. Default value: "0". Ex. "10900"

"maxtime": Optional field. Can be used in combination with "mintime" to set a time slot for the inventory item. Default value "0". Ex. "11600"

"label": A short one word label for the item. Ex. "Book".

"descr": A description of the item.

"nodecode": Unique code. Presented in the following format: "BKT00000", "VEN000000", "TAG0024".

"images" =>

"folder": Folder identifier where an image is being pulled from.

"file": Name of file in the following format: "000000.png".

Items Node
View More
json
"items": {
  "MPQJXQFFN0A": {
    "modtstamp": "1713551217",
    "globaltype": "experience",
    "venueid": "0000000",
    "caldate": "2024-04-27",
    "cutofftstamp": "0",
    "arriveby": "0",
    "ecozone": 0,
    "starttime": "10700",
    "endtime": "12200",
    "masteritemcode": "MAS000001",
    "masteritemid": "000001",
    "mastercode": "MPQJXQFFN0A",
    "itemname": "UV Restaurant",
    "highlight": "UrVenue Restaurant",
    "currency": "usd",
    "itempic": "image/url",
    "pricing": "novalue",
    "itempic": "",
    "layoutcode": "LAY0",
    "listprice": 0,
    "capacity": "1",
    "stock": "5",
    "totalstock": "500",
    "locstock": "1",
    "minqty": "1",
    "maxqty": "5",
    "mintime": "0",
    "maxtime": "0",
    "locids": "",
    "tagids": [
      "10001"
    ],
    "inactive": "0",
    "label": "Book",
    "terms": "TERMS",
    "itemtype": "activity",
    "termid": "000000",
    "paytype": "reserve",
    "descr": "",
    "timemode": "None",
    "state": "on",
    "vendor": "",
    "disclaimer": "Pricing based on 1 guests",
    "badge": "Available",
    "timelabel": "10:00pm to 4:00am",
    "tags": "10247",
    "ecocode": "ECZ000",
    "marketplace": 1,
    "breakdowns": {...},
    "pricingdisplay": "Experience",
    "booktypename": "Food & Beverage",
    "qtylabel": "Guests",
    "qtys": [...],
    "booktypecode": "BKT000000",
    "venuecode": "VEN0000000",
    "currency_symbol": "$",
    "paynow": 0,
    "paybase": 0,
    "basedisplay": "Pay Now",
    "listzero": "Included"
    "sku": "OZOZW",
    "econame": null,
    "skuname": "General Admission - Ladies"
  },
  "MVNNURAFN0A": {...},
  "MRDPMLBFN0A": {...},
},
"modtstamp": UNIX time stamp of the last time the item was modified. Ex. "1710436460"

"globaltype": Type of item. Examples includes "admission", "seating".

"venueid": Unique identification number for the venue. "000000"

"caldate": Calendar date the item is available on. Formatted as: "YYYY-MM-DD".

"cutofftstamp": UNIX time stamp to denote when the item is no longer available. Ex "1710436460"

"arriveby": The time that the customer is expected to arrive for the item. (Format: 00000, first number indicates if it is before or after midnight, next two determine the hour, next two is the minutes). Ex. "10600"

"ecozone": Number of ecozones the item is in. Ex. 001

"starttime": The exact start time for how long that item is booked. The first digit indicates if it is the same day "1" or the next day "2". Ex. "10900"

"endtime": The exact end time for how long that item is booked.The first digit indicates if it is the same day "1" or the next day "2". Ex. "11000"

"masteritemcode": Unique code identifier for the master item within inventory. Presented in the following format: "MAS00000". This is the code that will need to be returned to Booketing when an item is booked so that it can be removed from inventory.

"masteritemid": Identification number belonging to the item. Ex. 000000

"mastercode": Unique code specific to the item. Ex. MSABCDEF0N

"itemname": Name for the specific item. Ex "Scooter Rental"

"highlight": Short item highlight describing the item.

"currency": Currency used to purchase item. Ex. "usd"

"pricing": The type of pricing the item belongs to. Ex. "rentalfee".

"itempic": Contains a url for the picture of the item. Ex. "https:///imateq/masteritems/10000/100/raw/100.jpeg".

"layoutcode": Specific code for the layout of the items. Ex "LAY0"

"listprice": Price of the item. Ex. "50"

"capacity": Total capacity of the item. Ex. "2"

"stock": Inter value to represent the quantity of the item (chairs, tables, etc.) available in stock for purchase. Ex. "20"

"totalstock":

"locstock": Indicates the location number that the stock of the item will be placed. Works best if the venue has a sectioned, numbered, map. Ex. "1".

"minqty": Field to represent the minimum quantity of the item that can be set as available within stock. Ex. "1"

"maxqty": Field to represent the maximum quantity of the item that can be set as available within stock. Ex. "10"

"mintime": Optional field. Can be used in combination with "maxtime" to set a time slot for the inventory item. Default value: "0". Ex. "10900"

"maxtime": Optional field. Can be used in combination with "mintime" to set a time slot for the inventory item. Default value "0". Ex. "11600"

"locids": Ids of item locations (when available). Ex. "106001,106002,106003,106004,106005"

"tagids": Ids of tags assoicated with the item Ex. [ "0000", "00001" ]

"inactive": Field to represent the quantity of inventory that is set to inactive. Default value: "0".

"label": A short one word label for the item. Ex. "Book"

"terms": Terms and conditions field. Ex. "These are terms for the item"

"itemtype": General type of item. Ex. "equipment"

"termid": Identification number for the terms and conditions that apply to the item. Ex. "0001"

"paytype": Indicates the payment method used. Ex. "reserve"

"descr": Optional item description field.

"timemode": Stores the value of the item mode. Works with items that can only be sold at a certain time (AM, PM). Default value. "None".

"state": Indicates the state of the item. Ex: "on", "off", "waitlist".....

"vendor": Denotes name of owner if item is from a 3rd party (Opentable, Book4Time, etc).

"disclaimer": Transparent pricing disclaimer to be displayed on the front end booking journey.

"badge": Urgency badge label to indicate low stock, hot items, etc.

"timelabel": String representing the time span of the item.

"tags": Show the tadids of associated to the item. Ex. "0000,00000"

"ecocode": Code to represent the ecozone that the item belongs to. Presented in the following format: "ECZ000".

"marketplace": Indicates whether a item is in the marketplace. Ex. 1 if in the marketplace else 0.

"pricingdisplay": Returns the inventory item price. Ex. "Booking Fee"

"booktypename": Type of item.

"qtylabel": Label to indicate the type of item within "qtys".

"qtys": Lists all possible quantities from the item in an array.

"booktypecode": Unique booking code. Presented in the following format: "BKT00000".

"venuecode": Unique code specifier to the venue that the items belong to. Presented in the following format: "VEN000000".

"currency_symbol": symbol of the currency used. Ex. "$"

"paynow": The total amount paid

"paybase": The subtotal amount.

"basedisplay": Label to use on front end interface to indicate book action.

"listzero": Field to indicate if an item has the ability to be listed as zero. Default value: "Included".

"sku": Stock keeping unit, allow for catelog-like ingestion and categorization of inventory.

"econame": Name of the ecozone the item belongs to.

"skuname":Name to go along with the "sku" name above to allow for one to one mapping mapping.

Items -> Breakdowns Sub-Node
View More
json
"breakdowns": {
  "prepay": {
    "total": {
      "name": "Total",
      "amount": 0
    },
    "subtotal": {
      "name": "Subtotal",
      "amount": 0
    },
    "nationsales1": {
      "name": "Goods and Services Tax",
      "amount": 0
    }
  }
}
"name": Name of the breakdown.

"amount": Amount of the breakdown.

Venues Node
View More
json
"venues": {
  "VEN000000": {
    "info": {...},
    "images": {...},
    "socials": [...],
    "seasons": {...},
    "currentophours": {...},
    "ecozones": {
      "ECZ000": {
        "name": "Ur Bar"
      }
    }
  },
  "VEN000000": {...},
}
"venues" => {"venuecode"} =>

"ecozones" => {"ecocode"} =>

"name": venue name within this ecozone.
Venues -> Info Sub-Node
View More
json
"info": {
  "code": "VEN000000",
  "modtstamp": "1708040240",
  "name": "VENUE NAME",
  "tagline": "VENUE TAGLINE",
  "timezone": "TIMEZONE",
  "descr": "",
  "lon": 000.0000,
  "lat": 000.0000,
  "address": "VENUE ADDRESS",
  "city": "VENUE CITY",
  "zip": "VENUE ZIPCODE",
  "province": "VENUE PROVINCE",
  "country": "VENUE COUNTRY",
  "websiteurl": "VENUE WEBSITE",
  "email": "VENUE_EMAIL.com",
  "phone": "+1 000-000-0000",
  "wbcode": "",
  "directions": "",
  "venuetype": "Restaurant",
  "marketarea": "MARKETAREA",
  "propertyname": "VENUE PROPERTY NAME",
  "ext_propertycode": "CET",
  "urvenueid": "0",
  "createdmarketareaid": "0000",
  "otid": "000000",
  "manageentid": "0000",
  "dresscode": "",
  "location": "VENUE LOCATION",
  "marketareacode": "MKA0000",
  "propertycode": "PRP000000",
  "venuetypecode": "VNT0000",
}
"code": Unique code specific to the venue that the items belong to. Presented in the following format: "VEN000000".

"modtstamp": Time stamp to indicate the last time an venue was modified. Presented in UNIX time with the following format: "0000000000".

"name": Name assigned to the venue. Can be as descriptive as necessary.

"tagline": Optional field, can be left empty. Used to post a venue’s tagline.

"timezone": Holds the time zone that the venue is placed in.

"descr": A short description field where a venue can be further described.

"lon": Uses a floating-point number to hold the longitude value of a venue’s location.

"lat": Uses a floating-point number to hold the latitude value of a venue’s location.

"address": Venue-specific address in the following format: "1234 Sample St.".

"city": Holds the city where the venue is located.

"zip": Holds the venue’s zip code in the following format: "12345".

"province": Holds the state/providence the venue is located in the following format: "CA", "NV", "AZ".

"country": Holds the country the venue is located in the following format: "US", "MX".

"websiteurl": Holds a link to the venue’s personal website.

"email": Field to hold a venue’s master email. If no master email is present, it may stay empty. "".

"phone": Holds the venue’s main phone number.

"wbcode": Optional field. Can be left empty.

"directions": Venue directions for patrons to follow once they arrive. Optional field.

"venuetype": Field to specify the type of venue being configured in the following format: "Dayclub", "Nightclub", "Pool", etc.

"marketarea": The venue’s specific market area, in the following format: "City, State/Province, Country".

"propertyname": Field to hold name of the property if different than the name of the venue.

"ext_propertycode": External identifier for the property a venue is located at.

"urvenueid": Unique, Urvenue specific ID.

"createdmarketareaid": Field to hold the specific market area ID that the venue is located in.

"otid": Holds the OT ID number.

"manageentid": Unique management entity-ID number.

"dresscode": Field used to specify a venue's dress code.

"location": City the venue is located in.

"marketareacode": The market area code that the venue is located in. Presented in the following format: "MKA000".

"propertycode": Unique property code specific to the venue. Presented in the following format: "PRP0".

"venuetypecode": Code that identifies the type of venue that it is. (Format: VNT0000).

Venues -> Images Sub-Node
View More
json
"images": {
    "IMT0000": [
      {
        "imagerationame": "",
        "alttext": "",
        "mimetype": "jpg",
        "bgtype": "",
        "imagetypename": "Action Shot",
        "folder": "venue",
        "subfolder": "0000",
        "bsname": "0000",
        "path": "/PATH",
        "file": "FILENAME.jpg",
        "imagecode": "IMG000000",
        "imagetypecode": "IMT0000"
      },
      {...},
    ],
    "IMT00000": [...],
}
Building Image Url and Manipulation https://web.urvenue.com/affiliates/image-manipulation-uris/
Venues -> Socials Sub-Node
json
"socials": [
  {
    "linktypecode": "LIB0000",
    "url": "https://www.facebook.com/VENUE",
    "linktype": "Facebook"
  },
  {...},
],
"linktypecode": Unique code to specify the link type. Follows the format: "LIB0000"(LIB, followed by a 4-digit code).

"url": URL link to the performer’s social media profile

"linktype": Specifies the type of line the URL above holds. Examples include "Facebook", "Twitter", "Instagram".

Venues -> Seasons Sub-Node
View More
json
"seasons": {
  "ophours": {
    "S0": {
      "seasonid": "0",
      "seasonname": "Regular Season",
      "activeseason": "1",
      "weekdays": {...},
    },
    "S0000001": {
      "seasonid": "0000001",
      "seasonname": "SEASON",
      "activeseason": "0",
    },
    "S0000023": {...},
  },
  "range": [
    {
      "seasonref": "",
      "seasonid": "0",
      "seasonname": "Regular Season",
      "seasonsstring": "Up to Dec 31, 2023",
      "startdate": "",
      "enddate": "2023-12-31",
    },
    {...},
  ]
},
"ophours" => {"SeasonCode"} => (Ex. S0, S0002)

"seasonid": Integer value to represent the ID of the current season. Default is "0".

"seasonname": Name of the season that needs to be assigned to the venue. Examples include "Regular Seasons", "Winter Season", "Slow Season", etc.

"activeseason": Indicates if the season is active with "1" or not with "0".

"seasons" => "range" =>

"seasonref": Season reference field. Optional, defaults to: "".

"seasonid": Integer value to represent the ID of the current season. Default is "0".

"seasonname": Name of the season that needs to be assigned to the venue. Examples include "Regular Seasons", "Winter Season", "Slow Season", etc.

"seasonsstring": String representation for the current season ("Always", "Winter", "Summer", etc).

"startdate": Used in conjunction with "enddate". Delimits the start and end of the season.

"enddate": Used in conjunction with "startdate". Delimits the start and end of the season.

Venues -> CurrentOp Hours Sub-Node
View More
json
"currentophours": {
    "weekstring": null,
    "weekdays": {
      "WD3": [
        {
          "weekday": "3",
          "nopentime": "21100",
          "nclosetime": "21600",
          "fullday": "0",
          "timestring": "From 11:00am to 4:00pm"
        }
      ],
      "WD4": [...],
  }
}
"weekdays" => "WD{weekday}" => (Ex. WD3, WD6)

"weekday": Field that holds an integer value that is mapped out to a day of the week.

"nopentime": Represented in 48-hour time. Start open time for a venue.

"nclosetime": Represented in 48-hour time. End close time for a venue.

"fullday": Field used to indicate if venue is open for the whole day.

"timestring": String, English-readable representation of the open-close time.

Schedules Node
View More
json
"schedules": {
  "D900101": {
    "VEN000001": {
      "ECZ0": {
        "status": "Open",
        "dayopen": 1,
        "ophoursstring": null,
        "source": "Event",
        "weekdays": [...],
        "venuename": "VENUENAME",
        "event": {...},
        "eventcode": "EVE000000000000000",
        "eventid": "0000000",
        "weekstring": "blah1",
        "itemtypes": {
            "admission": 4,
            "table": 3,
            ...
        }
      },
      "ECZ1": {...},
    },
    "VEN000002": {...},
    "VEN000003": {...},
  },
  "D900102": {...},
},
"status": Ecozone status. Example values include: "Open", "Close".

"dayopen": Field to indicate how many days of the week the ecozone is open.

"ophoursstring": Operational hours of the venue given in a string.

"source": Indicates where data to populate information is being pulled from. In this case, it is from "Event".

"venuename": Name of the venue being configured.

"eventcode": Unique event code generated in the following format: "EVE00000000000000000".

"eventid": Unique event ID number for a singular, specific event.

"weekstring": String containing what week it is.

"itemtypes" =>

{"itemtype"}: count of item with this itemtype.
Schedules -> Weekdays Sub-Node
json
"weekdays": [
  {
    "weekday": "6",
    "nopentime": "12200",
    "nclosetime": "",
    "fullday": "0",
    "timestring": "From 10:00pm to 12:00am"
  }
],
"weekdays" =>

"weekday": Field that holds an integer value that is mapped out to a day of the week.

"nopentime": Represented in 48-hour time. Start open time for a venue.

"nclosetime": Represented in 48-hour time. End close time for a venue.

"fullday": Field used to indicate if venue is open for the whole day.

"timestring": String, English-readable representation of the open-close time.

Schedules -> Event Sub-Node
View More
json
"event": {
    "name": "EVENTNAME",
    "descr": "",
    "shortdescr": "",
    "privatedescr": "",
    "priority": "-1",
    "roomid": "0",
    "caldate": "2024-03-20",
    "ticketsurl": "",
    "promovideourl": "",
    "venuename": "VENUENAME",
    "private": "0",
    "allowinquiries": "0",
    "eventid": "0000000",
    "eventtypeid": "00000",
    "eventtypename": "Other",
    "ndoorsopen": "",
    "ndoorsclose": "",
    "nstarttime": "",
    "nendtime": "",
    "flyers": {
        "IMT0001": [
          {
            "imagerationame": "Horizontal",
            "alttext": "",
            "mimetype": "any",
            "bgtype": "",
            "imagetypename": "",
            "folder": "event",
            "subfolder": "0000",
            "bsname": "0000/00000",
            "path": "FLYERPATH",
            "file": "0000000.jpeg",
            "imagecode": "IMG0",
            "imagetypecode": "IMT0001",
            "imageratiocode": "IMR0000"
          }
        ]
      },
    "ecozones": [
      {
        "ecozoneid": "0",
        "name": "",
        "starttime": "0",
        "endtime": "0"
      }
    ],
    "performers": {
      "PER000000": {
        "perfcode": "PER000000",
        "importance": "2",
        "apprtime": "0"
      }
    }
},
"name": Name given to the event.

"descr": Optional event description field.

"shortdescr": Optional event short description field.

"privatedescr": description of private event

"priority": Integer value used to indicate event priority. Default value: "0".

"roomid": Room identification number. Default value: "0".

"caldate": Calendar date that the inventory item can begin being shown. Format: "YYYY-MM-DD"

"ticketsurl": URL link to a ticket page (Optional field, default: "").

"promovideourl": URL link to a promotional video. If none available, value is: null.

"venuename": Name of the venue. Ex. "UrVenue"

"private": Field to indicate whether event is private or public. Default public value: "0”.

"allowinquiries": Field to indicate if the venue allows for inquiries to be made. Default public value: "0"

"eventid": Unique event ID number for a singular, specific event. Ex. "000000"

"eventtypeid": ID for the type of event Ex. "0000"

"eventtypename": Field used to specify the type of event being held by the venue. Ex. "Other"

"ndoorsopen": Field used to indicate the time doors open for the event. Left as empty for default value. Ex. "12200"

"ndoorsclose": Field used to indicate the time doors close for the event. Left as empty for default value. Ex. "20200"

"nstarttime": Denotes the start time of the event (48-hour format). Ex. "12200"

"nendtime": Denotes the end time of the event (48-hour format). Ex. "20200"

"flyers" => {imagecode}

"imagerationame": Optional field, can be left empty. Used to identify the ratio of an inserted flyer image.

"alttext": Optional field, can be left empty.

"mimetype": Field to indicate the file extensions type. Examples include: "jpg", "png", etc.

"bgtype": Sets the background type for the venue presentation page.

"imagetypename": Identifies what type of image is being uploaded (logo, map, etc.)

"folder": Folder identifier where an image is being pulled from. Used with "subfolder".

"subfolder": Subfolder identifier where an image is being pulled from. Used with "folder".

"bsname": Further helps narrow down an image's location.

"path": Direct path to the image. Has portions of above fields present.

"file": Name of file in the following format: "000000.png".

"imagecode": Unique image code field in the following format: "IMG000000".

"imagetypecode": Code type of the image being used in the following format: "IMT000000".

"imageratiocode": Code to identify the image ratio. Uses the following format: "IMR0000".

"ecozones" =>

"ecozoneid": Integer value to represent the ID of the ecozone.

"name": Name of the ecozone. Default "".

"starttime": Denotes the start time of the event (24-hour format).

"endtime": Denotes the end time of the event (24-hour format).

"performers" => {perfcode}

"perfcode": Unique code specific of the performer. Ex. "PER000000"

"importance": Represents importance of performer when multiple performers are scheduled for the same event with "0" the most important.

"apprtime": The time a performer is set to appear. "0" if no specified time is set.

PARAMS
apikey
sourcecode
test

sourceloc
postman

caldate
todate
venuecode
VEN505115

filters
data:schedule

venuecode
Example Request
inventory
View More
curl
curl --location 'https://apiuat.urvenue.me/v4/gxn/inventory/json/?apikey=&sourcecode=test&sourceloc=postman&caldate=&venuecode=VEN505115'
Example Response
Body
Headers (0)
No response body
This request doesn't return any response body
GET
inventory_info
https://apiuat.urvenue.me/v4/gxn/inventoryinfo/json/?apikey=&sourcecode=test&sourceloc=postman&mastercode=
Overview
Retrieves everything you need to know about a single inventory mastercode in one call. Item metadata, fee breakdowns, available quantities and a full price matrix across shifts and durations.

Shared Query Parameters
apikey (required): Your authentication key

sourcecode (required): Code identifying the source system

sourceloc (required): Code identifying the source location

Endpoint‑Specific Parameters
mastercode (required): The inventory mastercode to look up
Key Features
Basic Item Details: name, description, category, timing, etc.

Fees & Totals: all fee names with their calculated amounts

Available Quantities: min/max and any channel‑specific stock levels

Price Matrix: granular breakdown by shift + duration (incl. taxes/surcharges)

Response Structure
info: core item fields (timing, pricing defaults, quantities)

library: human‑readable labels for fees and taxes

qtys: list of all valid quantities

pricematrix: nested object of shifts → durations → breakdowns + components

json
{
    "success": 1,
    "http_code": 200,
    "message": "success",
    "data": {
      "info": {...},
      "library": {...},
      "qtys": [...],
      "pricematrix": {...}
    }
}
Response Analysis
"info" Node
View More
json
"info": {
    "network": "internal",
    "partnertype": null,
    "timemode": "SignleTime",
    "timemode": "TimeDuration",
    "listzero": "Included",
    "seatingtype": "section",
    "layout": {...},
    "paytypedefault": "reserve",
    "modified_timestamp": "1710436460",
    "caldate": "2024-03-20",
    "mastercode": "MSABCDEFG0Z",
    "masteritemcode": "MAS000000",
    "globaltype": "equipment",
    "venuecode": "VEN000000",
    "ecocode": "ECZ000",
    "layoutcode": "0",
    "booktypeid": "000000",
    "tourlink": ,
    "label": "Daybeds",
    "channelcode": "CH0",
    "cutofftstamp": "1710969300",
    "arriveby": "0",
    "listprice": 0,
    "starttime": "09:00",
    "enduvtime": "11600",
    "endtime": "16:00",
    "currency": "usd",
    "currency_symbol": "$",
    "minqty": "1",
    "maxqty": "8",
    "capacity": "1",
    "defaultqty": "1",
    "itemname": "Scooter Rental",
    "specs": [...],
    "highlight": "",
    "locids": "",
    "qtytype": "guests",
    "guestsitem": "fixed",
    "unitname": "Guest",
    "images": [...],
    "terms": "",
    "paytypes": {...},
    "bullets": [...],
    "duration": "0",
    "itinerary": "",
    "descr": ""
},
"network": refers to the type or category of the transaction network being used for the order.

"partnertype": Indicates the type of partnership they have with UrVenue.

"subtitle": Subtitle for the item if appicable.

"timemode": Stores the value of the item mode. Works with items that can only be sold at a certain time (AM, PM). Default value. "None".

"listzero": Field to indicate if an item has the ability to be listed as zero. Default value: "Included".

"seatingtype": Indicates the type of seating for this item.

"layout": Houses information regarding the 3d map layout for the item.

"paytypedefault": Indicates the default payment method used.

"modified_timestamp": Time stamp to indicate the last time an venue was modified.

"caldate": Calendar date usually used as a start date.

"mastercode": Unique code specific to the item.
"masteritemcode": Unique code identifier for the master item within inventory. Presented in the following format: "MAS00000".

"globaltype": Type of item. Examples includes "admission", "seating".

"venuecode": Unique code specifier to the venue that the inventory list items belong to. Presented in the following format: "VEN000000".

"ecocode": Code to represent the ecozone that the item belongs to. Presented in the following format: "ECZ000".

"layoutcode": Specific code for the layout of the items.

"booktypeid": Identifier of the booktype.

"tourlink": URL to 360 image when available.

"label": Item category label.

"channelcode": Specific code for the channel.

"cutofftstamp": UNIX time stamp to denote when the item is no longer available.

"arriveby": The time that the customer is expected to arrive for the item. (Format: 00000, first number indicates if it is before or after midnight, next two determine the hour, next two is the minutes).

"listprice": Price of the item.
"enduvtime": Denotes the end time of the event Format THHMM where T is either "1" for the same day or "2" for the next day.

"starttime": Denotes the start time of the event (24-hour format).

"endtime": Denotes the end time of the event (24-hour format).

"currency": Currency used to purchase item.

"currency_symbol": symbol of the currency used.

"minqty": Field to represent the minimum quantity of the item that can be set as available within stock.

"maxqty": Field to represent the maximum quantity of the item that can be set as available within stock.

"capacity": Total capacity of the item.

"itemname": Name for the specific item.

"defaultqty": The configured default quantity that guests first are able to purchase. Can be adjusted.

"specs": Lists item specificatiion such as if the item is for seating, if it is for sale, etc.

"highlight": Short item highlight describing the location/item.

"locids": Ids of item locations (when available).

"qtytype": The type of quantity for the item.

"guestsitem": This is to indicate the guests per item. Typically "fixed" or "variable".

"unitname": Specifies how units of the item are sold (per guest, per seat, etc.).

"images": Containts inforamtion regarding item imagees, if available.

"terms": Terms and conditions field.

"paytypes": Lists all available pay types available for the item.

"bullets": List of checkout bullets attached to the item. These bullets contain item iimportant item infoirmation.

"duration": Specific duration the current master item belongs to.

"itinerary": Specifies if item belongs to an itinerary.

"descr": Optional event description field.

"library" Node
View More
json
"library": {
    "breakdowns": {
    "hospfee1": "Beyond the Booth",
    "ccfee1": "CC Fee",
    "autograt1": "Gratuity",
    "let1": "LET Tax",
    "procfee1": "Processing Fee",
    "globalsales1": "Sales Tax",
    "subtotal": "Subtotal",
     "total": "Total"
    },
    "vendors": {
         "assigned": [],
         "unassigned": []
     }
},
Under "breakdowns" , information regarding all available fees are listed.

Additionally a "vendor" node is available to detail assigned/unassigned vendors for the item.

"qtys" Node
This node displays how many quantities are available for a specified item.

"pricematrix" Node
json
"pricematrix": {
    "SHT0": {
       "DUR0": {
          "breakdowns": {...},
          "components": [...]
       },
   },
}
The "pricematrix" node provides in depth pricing details in parsable layers. If first breaks into shifts before narrowing down on a duration. From there a breakdown is displayed for each paytype and quantity available.
This allows for all pulled pricing to be calcualated in the backend, minimizing pricing errors.

PARAMS
apikey
sourcecode
test

sourceloc
postman

mastercode
Example Request
inventory_info
View More
curl
curl --location 'https://apiuat.urvenue.me/v4/gxn/inventoryinfo/json/?apikey=&sourcecode=test&sourceloc=postman&mastercode='
Example Response
Body
Headers (0)
No response body
This request doesn't return any response body


####START OF HOLDS###
Holds
The Hold APIs facilitate reservation and temporary holding of inventory items, supporting accurate inventory allocation and management.

inventory_hold POST: Enables creation of inventory holds, reserving specific inventory items or quantities based on prior availability checks.

item_hold POST: Adds individual items to existing hold orders, enabling precise inventory reservation management.

inventory_hold DELETE: Removes existing hold orders, freeing up reserved inventory for new reservations.

item_hold DELETE: Removes individual items from an existing hold, updating inventory availability accordingly.

view_hold GET: Retrieves detailed information about existing holds, including item specifics, quantities reserved, and hold durations.

POST
inventory_hold
https://apiuat.urvenue.me/v4/gxn/inventoryhold/json/?apikey=&sourceloc=postman&sourcecode=test&ext_cartref=&meta[info][0][first_name]=John&meta[info][0][last_name]=Doe&meta[info][0][dob]=2000-01-01&meta[info][0][email]=bob.smith@test.com&meta[info][0][phone]=7021112233&meta[refs][0][id]=007&meta[data-callback-url][0][success]=urcallback.com&meta[actions][0][success]=onOrderSuccess
Overview
Creates a temporary reservation (“hold”) on previously checked inventory, using an external cart reference. This lets you lock in items or quantities for later booking while you gather payment or customer details.

Shared Query Parameters
apikey (required): Your authentication key

sourcecode (required): Code identifying the source system

sourceloc (required): Code identifying the source location

Endpoint‑Specific Parameters
ext_cartref (required): External reference from a prior InventoryCheck
Key Features
Hold Creation: Reserve specific inventory by passing an external cart reference.

Hold Details: Returns hold metadata (hold code, expiration timestamp, channel/network info).

Transparent Management: Frees up or releases inventory automatically when holds expire or are deleted.

Response Structure
data.header:

holdcode: Generated hold identifier

ext_cartref: Echoes your external cart reference

expiretstamp: UNIX timestamp when the hold lapses

holdtype, partnerid, network, channelcode

data.items: Always null on creation—items are added separately

API Response
We will look at the structure of the response going through each field. This is a smaller response compared to the others.

Header Node
View More
json
"data": {
    "header": { 
        "holdcode": "XDOETNBSYSCR",
        "partnerid": "0",
        "holdtype": "hold",
        "ext_cartref": "ZN2PKCM6P5",
        "expiretstamp": "1710796689",
        "network": "marketplace",
        "meta": null,
        "channelcode": "CH0",
        "fellowshipcode": ""
    },
    "items": null
}
"holdcode": Code identifying the hold.

"partnerid": The identification number for the current partner.

"holdtype": Type of the hold

"ext_cartref": An external reference for the cart.

"expiretstamp": UNIX time stamp to denote when the item is no longer available.

"network": refers to the type or category of the transaction network being used for the hold.

"meta": Order references and other guest meta data can be passed through to this object

View More
json
meta='{
    "callback-url": [{
      "success": "INSERT_URL",
      "complete": "INSERT_URL",
      "incomplete": "INSERT_URL"
  }],
  "actions": [{
      "success": "INSERT_FUNCTION",
      "complete": "INSERT_FUNCTION",
      "incomplete": "INSERT_FUNCTION"
  }],
  "refs": [{
      "loyalty_id": "1234",
    "myVar": "hello"
    }],
  "info": [{
    "first_name": "Bob",
    "last_name": "Smith",
    "email": "test@google.com",
    "dob": "2001-12-12",
      "phone": "7021231234",
    "guest_notes": "hello world"
    }]
}'
"channelcode": Specific code for the channel.
Items Node
This will always be null as this API call only creates the hold. The next API will add indiviudal items to the hold.

PARAMS
apikey
sourceloc
postman

sourcecode
test

ext_cartref
meta[info][0][first_name]
John

meta[info][0][last_name]
Doe

meta[info][0][dob]
2000-01-01

meta[info][0][email]
bob.smith@test.com

meta[info][0][phone]
7021112233

meta[refs][0][id]
007

meta[data-callback-url][0][success]
urcallback.com

meta[actions][0][success]
onOrderSuccess

Example Request
inventory_hold
View More
curl
curl --location -g --request POST 'https://apiuat.urvenue.me/v4/gxn/inventoryhold/json/?apikey=&sourceloc=postman&sourcecode=test&ext_cartref=&meta[info][0][first_name]=John&meta[info][0][last_name]=Doe&meta[info][0][dob]=2000-01-01&meta[info][0][email]=bob.smith%40test.com&meta[info][0][phone]=7021112233&meta[refs][0][id]=007&meta[data-callback-url][0][success]=urcallback.com&meta[actions][0][success]=onOrderSuccess'
Example Response
Body
Headers (0)
No response body
This request doesn't return any response body

####END OF HOLDS #####

####START OF BOOKINGS ####
Bookings
The Bookings APIs manage the finalization and retrieval of inventory bookings, ensuring efficient reservation handling.

inventory_book POST: Finalizes previously held orders, including customer details and authorization codes, to officially reserve inventory.

view_booking GET: Retrieves detailed booking records, including customer information, booked items, and associated transaction data.

order_reference GET: Supports flexible order lookups based on custom or external references (e.g., loyalty numbers, custom booking identifiers).

POST
inventory_book
https://apiuat.urvenue.me/v4/gxn/inventorybook/json/?apikey=&sourcecode=test&sourceloc=postman&holdcode=&custinfo[partyname]=John Doe&authcode=&custinfo[guestnotes]=Lorem Ipsum&custinfo[firstname]=John&custinfo[lastname]=Doe&custinfo[email]=bob.smith@test.com&custinfo[phone]=7021112233&custinfo[internalnotes]=Lorem Ipsum&custinfo[dob]=2000-01-01&bookinfo[ext_orderref]=extorderefabc&bookinfo[affid]=TESTAFID123&items[][tixs][][qrcode]=qrcodeabc&items[][tixs][][ext_tixref]=exttixrefabc&items[][item][ext_itemref]=extitemrefabc&items[][item][ext_serviceref]=extservicerefabc&agree=&items[][item][ext_bookref]=extbookrefabc&items[][tixs][][ext_tixref]=HELLO123&items[][tixs][][itemgroupid]=ITEMGID123&bookinfo[ext_affcode]=321AFFCODE&custinfo[gender]=MALE&bookinfo[microcode]=MICRO123
Overview
Finalizes a hold into a confirmed booking by consuming all items under a given hold code, capturing customer and payment details, and generating the official order record. Ideal for completing transactions once inventory has been reserved.

Shared Query Parameters
apikey (required): Your authentication key

sourcecode (required): Code identifying the source system

sourceloc (required): Code identifying the source location

Endpoint‑Specific Parameters
holdcode (required): The hold identifier to convert into a booking

authcode (required): Authorization code for the booking

partner_commissions_amount (optional): Commission amount owed to the partner

agree (optional): Agreed total charge (if different from default)

Customer Info: custinfo[firstname], custinfo[lastname], custinfo[email], custinfo[phone], custinfo[dob], custinfo[gender], plus party‑level notes (guestnotes, internalnotes)

Booking Info: bookinfo[ext_orderref], bookinfo[affid], and other affiliate/owner/originator identifiers

Item References: For each held item, specify ticket‑level QR codes and external references (items[holditemcode][tixs][holdtixcode][qrcode], …[ext_tixref], etc.)

Payments (optional): payments[0][gateway], …[amount], …[tendertype] to record payment history

Key Features
Complete Booking: Transforms a hold into a finalized order, guaranteeing all reserved items are booked.

Detailed Order Response: Returns comprehensive order payload—including order codes, authorization, item breakdowns, and price details—for downstream systems.

Party & Ticket Records: Provides party grouping and per‑ticket information (QR codes, holder details), enabling seamless check‑in or fulfillment.

Audit‑Ready: Captures full customer, affiliate, and payment metadata to support reconciliation and reporting.

Response Structure
json
{
    "success": 1,
    "http_code": 200, 
    "message": "success",
    "data": {
        "orders": {...},
        "parties": {...}
    }
}
PARAMS
apikey
sourcecode
test

sourceloc
postman

holdcode
custinfo[partyname]
John Doe

required

authcode
ALWAYS needs auth code

custinfo[guestnotes]
Lorem Ipsum

can be [qrcode], [ext_itemref], [guestnotes], [internalnotes], [meta]

custinfo[firstname]
John

custom-> partyname

custinfo[lastname]
Doe

bookinfo->auth_code ext_orderref state, meta, affid,

custinfo[email]
bob.smith@test.com

custinfo[phone]
7021112233

custinfo[internalnotes]
Lorem Ipsum

custinfo[dob]
2000-01-01

bookinfo[ext_orderref]
extorderefabc

bookinfo[affid]
TESTAFID123

items[][tixs][][qrcode]
qrcodeabc

items[][tixs][][ext_tixref]
exttixrefabc

items[][item][ext_itemref]
extitemrefabc

holder_name, holder_email

items[][item][ext_serviceref]
extservicerefabc

agree
items[][item][ext_bookref]
extbookrefabc

(optional)

items[][tixs][][ext_tixref]
HELLO123

items[][tixs][][itemgroupid]
ITEMGID123

bookinfo[ext_affcode]
321AFFCODE

bookinfo[ownerid]
1234ABCD

custinfo[gender]
MALE

bookinfo[originatorid]
OGID123

bookinfo[microcode]
MICRO123

bookinfo[bookerid]
123ABC

Example Request
inventory_book
View More
curl
curl --location -g --request POST 'https://apiuat.urvenue.me/v4/gxn/inventorybook/json/?apikey=&sourcecode=test&sourceloc=postman&holdcode=&custinfo[partyname]=John%20Doe&authcode=&custinfo[guestnotes]=Lorem%20Ipsum&custinfo[firstname]=John&custinfo[lastname]=Doe&custinfo[email]=bob.smith%40test.com&custinfo[phone]=7021112233&custinfo[internalnotes]=Lorem%20Ipsum&custinfo[dob]=2000-01-01&bookinfo[ext_orderref]=extorderefabc&bookinfo[affid]=TESTAFID123&items[][tixs][][qrcode]=qrcodeabc&items[][tixs][][ext_tixref]=exttixrefabc&items[][item][ext_itemref]=extitemrefabc&items[][item][ext_serviceref]=extservicerefabc&agree=&items[][item][ext_bookref]=extbookrefabc&items[][tixs][][ext_tixref]=HELLO123&items[][tixs][][itemgroupid]=ITEMGID123&bookinfo[ext_affcode]=321AFFCODE&custinfo[gender]=MALE&bookinfo[microcode]=MICRO123'
Example Response
Body
Headers (0)
No response body
This request doesn't return any response body
GET
view_booking
https://apiuat.urvenue.me/v4/gxn/inventorybook/json/?apikey=&sourceloc=postman&sourcecode=test&ordercode=
Overview
Retrieves a finalized booking by its order code, providing a full snapshot of the transaction—including items, pricing, customer details, and party groupings—for downstream reporting or fulfillment.

Shared Query Parameters
apikey (required): Your authentication key

sourcecode (required): Identifier for the source system

sourceloc (required): Identifier for the source location

Endpoint‑Specific Parameters
ordercode (required): The unique code of the booking to fetch
Key Features
Booking Details: Returns metadata such as order ID, authorization code, external references, and booking timestamps.

Booked Items: Lists every item in the order with its identifier, description, quantity, unit pricing, and breakdown of fees and taxes.

Customer & Party Info: Includes customer contact data (name, email, phone, DOB, gender), party status/groupings, and any guest/internal notes for seamless communication and check‑in.

Response Structure
json
{
    "success": 1,
    "http_code": 200, 
    "message": "success",
    "data": {
        "orders": {...},
        "parties": {...}
    }
}
PARAMS
apikey
sourceloc
postman

sourcecode
test

ordercode
Example Request
view_booking
View More
curl
curl --location 'https://apiuat.urvenue.me/v4/gxn/inventorybook/json/?apikey=&sourceloc=postman&sourcecode=test&ordercode='
Example Response
Body
Headers (0)
No response body
This request doesn't return any response body
GET
view_order
https://apiuat.urvenue.me/v4/gxn/inventorybook/json/?apikey=&sourceloc=postman&sourcecode=test&ordercode=
Overview
Retrieves a finalized booking by its order code, providing a full snapshot of the transaction—including items, pricing, customer details, and party groupings—for downstream reporting or fulfillment.

Shared Query Parameters
apikey (required): Your authentication key

sourcecode (required): Identifier for the source system

sourceloc (required): Identifier for the source location

Endpoint‑Specific Parameters
ordercode (required): The unique code of the booking to fetch
Key Features
Booking Details: Returns metadata such as order ID, authorization code, external references, and booking timestamps.

Booked Items: Lists every item in the order with its identifier, description, quantity, unit pricing, and breakdown of fees and taxes.

Customer & Party Info: Includes customer contact data (name, email, phone, DOB, gender), party status/groupings, and any guest/internal notes for seamless communication and check‑in.

Response Structure
json
{
    "success": 1,
    "http_code": 200, 
    "message": "success",
    "data": {
        "orders": {...},
        "parties": {...}
    }
}
PARAMS
apikey
sourceloc
postman

sourcecode
test

ordercode
Example Request
view_order
View More
curl
curl --location 'https://apiuat.urvenue.me/v4/gxn/inventorybook/json/?apikey=&sourceloc=postman&sourcecode=test&ordercode='
Example Response
Body
Headers (0)
No response body
This request doesn't return any response body

####END OF BOOKINGS ####