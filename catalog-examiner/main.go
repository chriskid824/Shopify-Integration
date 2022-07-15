package main

import (
    "bytes"
    "context"
    "database/sql"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "sort"
    "strconv"
    "strings"
    "sync"
    "sync/atomic"

    _ "github.com/go-sql-driver/mysql"
    "cloud.google.com/go/pubsub"
    "github.com/joho/godotenv"
    "google.golang.org/api/idtoken"
)

var database *sql.DB
var isDoFix bool

func init() {
    err := godotenv.Load()
    if err != nil {
        fmt.Println("Error loading .env file")
    }

    user := os.Getenv("DB_USER")
    password := os.Getenv("DB_PASSWORD")
    dbName := os.Getenv("DB_NAME")
    host := os.Getenv("DB_HOST")
    db, err := sql.Open("mysql", user+":"+password+"@tcp("+host+")/"+dbName)

    if err != nil {
        panic(err.Error())
    }
    database = db

    isDoFix, _ = strconv.ParseBool(os.Getenv("IS_DO_FIX"))
}

func getVariants(id int) ([] string) {
    variants, err := database.Query(`
        SELECT sku
        FROM sys_stock
        WHERE product_id = ?`, id)

    if err != nil {
        panic(err.Error())
    }
    var skus []string
    for variants.Next() {
        var sku string
        variants.Scan(&sku);
        skus = append(skus, sku)
    }
    return skus
}

// from GCP golang samples
// `makeGetRequest` makes a request to the provided `targetURL`
// with an authenticated client using audience `audience`.
func makeGetRequest(w io.Writer, targetURL string, audience string) error {
	ctx := context.Background()

	// client is a http.Client that automatically adds an "Authorization" header
	// to any requests made.
	client, err := idtoken.NewClient(ctx, audience)
	if err != nil {
		return fmt.Errorf("idtoken.NewClient: %v", err)
	}

	resp, err := client.Get(targetURL)
	if err != nil {
		return fmt.Errorf("client.Get: %v", err)
	}
	defer resp.Body.Close()
	if _, err := io.Copy(w, resp.Body); err != nil {
		return fmt.Errorf("io.Copy: %v", err)
	}

	return nil
}

type PriceStock struct {
    Sku     string  `json:"sku"`
    Price   float64 `json:"price"`
    Qty     int     `json:"qty"`
    Source  string  `json:"source"`
}

type PriceStockResponse struct {
    Success bool            `json:"success"`
    Data    []PriceStock    `json:"data"`
}

func fetchPriceStockFromNexus(modelNumber string) []PriceStock {
    url := os.Getenv("NEXUS_PRICE_ENGINE")
	if url == "" {
		return nil
	}

    apiUrl := fmt.Sprintf("%s/modelNo/%s", url, modelNumber)
	var bodyBytesBuffer bytes.Buffer
	if err := makeGetRequest(&bodyBytesBuffer, apiUrl, url); err != nil {
        fmt.Println(err)
        panic(err.Error())
		return nil
	}
    
    var data PriceStockResponse
    json.Unmarshal(bodyBytesBuffer.Bytes(), &data)
    
    return data.Data
}

type Variant struct {
    Sku     string  `json:"sku"`
    Price   string  `json:"price"`
    Inventory struct {
        Qty struct {
            Value int `json:"available"`
        } `json:"inventoryLevel"`
    } `json:"inventoryItem"`
}

type ProductsData struct {
    Products struct {
        Edges []struct {
            Node struct {
                ID       string `json:"id"`
                Title    string `json:"title"`
                ModelNumber struct {
                    Value string `json:"value"`
                } `json:"modelNumber"`
                Variants struct {
                    Edges []struct {
                        Node Variant `json:"node"`
                    } `json:"edges"`
                } `json:"variants"`
                Images struct {
                    Edges []struct {
                        Node struct {
                            ID  string `json:"id"`
                            URL string `json:"url"`
                        } `json:"node"`
                    } `json:"edges"`
                } `json:"images"`
            } `json:"node"`
        } `json:"edges"`
    } `json:"products"`
}

type ProductsResponse struct {
    Data ProductsData `json:"data"`
	Extensions struct {
		Cost struct {
			RequestedQueryCost int `json:"requestedQueryCost"`
			ActualQueryCost    int `json:"actualQueryCost"`
			ThrottleStatus     struct {
				MaximumAvailable   int `json:"maximumAvailable"`
				CurrentlyAvailable int `json:"currentlyAvailable"`
				RestoreRate        int `json:"restoreRate"`
			} `json:"throttleStatus"`
		} `json:"cost"`
	} `json:"extensions"`
}

func fetchFromShopify(sku string) ProductsData {
    // TODO: Retry if request fails

    shop := os.Getenv("SHOPIFY_SHOP")
    url := fmt.Sprintf("https://%s/admin/api/2022-01/graphql.json", shop)
    headers := map[string]string{
        "X-Shopify-Access-Token": os.Getenv("SHOPIFY_TOKEN"),
        "Content-Type": "application/json",
    }
    queryStr := `
        query Products($q: String!, $locationId: ID!) {
          products(first: 10, query: $q) {
            edges {
              node {
                id
                title
                modelNumber: metafield(namespace: "product", key: "model_no") {
                  value
                }
                variants(first: 30) {
                  edges {
                    node {
                      price
                      sku
                      inventoryItem {
                        inventoryLevel(locationId: $locationId) {
                          available
                        }
                      }
                    }
                  }
                }
                images(first: 3) {
                  edges {
                    node {
                      id
                      url
                    }
                  }
                }
              }
            }
          }
        }
    `

    // Escape sku for query
    escapedSku := strings.Replace(sku, `\`, `\\`, -1)
    escapedSku = strings.Replace(escapedSku, `:`, `\:`, -1)
    escapedSku = strings.Replace(escapedSku, `(`, `\(`, -1)
    escapedSku = strings.Replace(escapedSku, `)`, `\)`, -1)
    q := fmt.Sprintf("(title:*%s*) OR (sku:%s)", escapedSku, escapedSku)
    locationId := fmt.Sprintf("gid://shopify/Location/%s", os.Getenv("SHOPIFY_LOCATION_ID"))
    query := map[string]interface{}{
        "query": queryStr,
        "variables": map[string]string{
            "q": q,
            "locationId": locationId,
        },
    }
    // Encode query
    jsonQuery, err := json.Marshal(query)

    // HTTP Post
    req, _ := http.NewRequest("POST", url, strings.NewReader(string(jsonQuery)))
    for key, value := range headers {
        req.Header.Set(key, value)
    }

    // Get response
    client := &http.Client{}
    resp, err := client.Do(req)
    if err != nil {
        fmt.Println(err)
        panic(err.Error())
    }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        fmt.Println("Status code:", resp.StatusCode)
        panic("Error")
    }
    var data ProductsResponse
    bodyBytes, _ := io.ReadAll(resp.Body)
    json.Unmarshal(bodyBytes, &data)
    if err != nil {
        fmt.Println("Error:", err)
        panic(err.Error())
    }
    candidates := data.Data

    var productsData ProductsData
    for _, edge := range candidates.Products.Edges {
        node := edge.Node
        if node.ModelNumber.Value == sku {
            productsData.Products.Edges = append(productsData.Products.Edges, edge)
        }
    }
    return productsData
}

func publishToPubsub(projectID string, topicID string, dataArr []string) error { 
    ctx := context.Background()
    client, err := pubsub.NewClient(ctx, projectID)
    if err != nil {
        return fmt.Errorf("pubsub.NewClient: %v", err)
    }
    defer client.Close()

    var wg sync.WaitGroup
    var totalErrors uint64
    t := client.Topic(topicID)

    for i, data := range dataArr {
        fmt.Println([]byte(data), data)
        result := t.Publish(ctx, &pubsub.Message{
            Data: []byte(data),
        })

        wg.Add(1)
        go func(i int, res *pubsub.PublishResult) {
            defer wg.Done()
            // The Get method blocks until a server-generated ID or
            // an error is returned for the published message.
            id, err := res.Get(ctx)
            if err != nil {
                // Error handling code can be added here.
                fmt.Sprintf("Failed to publish: %v", err)
                atomic.AddUint64(&totalErrors, 1)
                return
            }
            fmt.Sprintf("Published message %d; msg ID: %v\n", i, id)
        }(i, result)
    }

    wg.Wait()

    if totalErrors > 0 {
        return fmt.Errorf("%d of %d messages did not publish successfully", totalErrors, len(dataArr))
    }
    return nil
}

type PriceStockMessage struct {
    Sku         string  `json:"sku"`
    Price       float64 `json:"price"`
    Qty         int     `json:"qty"`
    Source      string  `json:"source"`
    Timestamp   int     `json:"timestamp"`
}

func countIncorrectPriceStock(keys []string, a map[string]PriceStock, b map[string]PriceStock) (int, []string) {
    incorrect := 0
    var pubsubData []string
    for _, k := range keys {
        ap := a[k].Price
        aq := a[k].Qty
        bp := b[k].Price
        bq := b[k].Qty
        if (ap != bp && aq > 0 && bq > 0) || (aq != bq && ap > 0 && bp > 0) {
            fmt.Println("Price/stock mismatch (Nexus/Shopify)", k, ap, "/", bp, " ; ", aq, "/", bq)
            incorrect++
            messageData := PriceStock{
                Sku: k,
                Price: ap,
                Qty: aq,
                Source: a[k].Source,
            }
            messageBytes, _ := json.Marshal(messageData)
            pubsubData = append(pubsubData, string(messageBytes))
        }
    }
    return incorrect, pubsubData
}

func compareVariants(a [] string, b [] string) bool {
    // Handle empty array where a is empty but b has one element with
    // empty sku
    if len(a) == 0 && len(b) == 1 && b[0] == "" {
        return true
    }
    if len(a) != len(b) {
        return false
    }
    sort.Strings(a)
    sort.Strings(b)
    for i := 0; i < len(a); i++ {
        if a[i] != b[i] {
            return false
        }
    }
    return true
}

type Problem struct {
    notFound bool
    notUnique bool
    incorrectVariants bool
    incorrectPriceStockCount int
    variantCount int
    pubsubData []string
}

func checkModel(id int, modelNumber string) Problem {
    data := fetchFromShopify(modelNumber)

    if len(data.Products.Edges) == 0 {
        fmt.Println("Product does not exist", modelNumber)
        return Problem{
            notFound: true,
        }
    } else if len(data.Products.Edges) > 1 {
        fmt.Println("Product has redundant copies", modelNumber)
        // Print all Ids
        for _, edge := range data.Products.Edges {
            fmt.Println(edge.Node.ID)
        }
        return Problem{
            notUnique: true,
        }
    } else {
        variants := getVariants(id)

        edges := data.Products.Edges[0].Node.Variants.Edges;
        shopifyVariants := make([] string, len(edges))
        shopifyPriceStock := make(map[string]PriceStock)
        for i, edge := range edges {
            shopifyVariants[i] = edge.Node.Sku
            shopifyPrice, _ := strconv.ParseFloat(edge.Node.Price, 64)
            shopifyPriceStock[edge.Node.Sku] = PriceStock{
                Sku: edge.Node.Sku,
                Price: shopifyPrice,
                Qty: edge.Node.Inventory.Qty.Value,
            }
        }

        // Compare variants with shopify variants
        if !compareVariants(variants, shopifyVariants) {
            fmt.Println("Variants do not match", modelNumber, variants)
            return Problem{
                incorrectVariants: true,
            }
        }

        nexusPriceStock := make(map[string]PriceStock)
        nexusPriceStockArr := fetchPriceStockFromNexus(modelNumber)
        for _, item := range nexusPriceStockArr {
            nexusPriceStock[item.Sku] = item
        }

        // Compare nexus price/stock with shopify price/stock
        incorrectPriceStockCount, pubsubData := countIncorrectPriceStock(variants, nexusPriceStock, shopifyPriceStock)
        return Problem{
            incorrectPriceStockCount: incorrectPriceStockCount,
            variantCount: len(variants),
            pubsubData: pubsubData,
        }
    }
}

type Job struct {
    id int
    modelNumber string
}

func checkModelWorker(jobs <-chan Job, results chan<- Problem) {
    for job := range jobs {
        results <- checkModel(job.id, job.modelNumber)
    }
}

func run() {
    q, err := database.Query(`
        SELECT id, model_no
        FROM sys_product
        WHERE deleted = 0
        ORDER BY rand()
        LIMIT 200`)

    if err != nil {
        panic(err.Error())
    }
    defer q.Close()

    // Make channels
    jobs := make(chan Job, 1)
    results := make(chan Problem, 10000)

    numWorkers := 2
    for i := 0; i < numWorkers; i++ {
        go checkModelWorker(jobs, results)
    }

    numJobs := 0
    for q.Next() {
        var modelNumber string
        var id int
        err = q.Scan(&id, &modelNumber)
        if err != nil {
            panic(err.Error())
        }
        numJobs++
        jobs <- Job{id, modelNumber}
        if numJobs % 50 == 0 {
            fmt.Println("Processed", numJobs)
        }
    }

    notFound := 0
    notUnique := 0
    incorrectVariants := 0
    incorrectPriceStockCount := 0
    totalVariantCount := 0
    var pubsubData []string
    correct := 0
    for i := 0; i < numJobs; i++ {
        result := <-results
        error := false
        if result.notFound {
            notFound++
            error = true
        }
        if result.notUnique {
            notUnique++
            error = true
        }
        if result.incorrectVariants {
            incorrectVariants++
            error = true
        }
        if result.incorrectPriceStockCount > 0 {
            incorrectPriceStockCount += result.incorrectPriceStockCount
            if len(result.pubsubData) > 0 {
                pubsubData = append(pubsubData, result.pubsubData...)
            }
            error = true
        }
        totalVariantCount += result.variantCount
        if !error {
            correct++
        }
    }
    fmt.Println("Number of products:", numJobs)
    fmt.Println("Not found:", notFound, float64(notFound) / float64(numJobs))
    fmt.Println("Not unique:", notUnique, float64(notUnique) / float64(numJobs))
    fmt.Println("Incorrect variants:", incorrectVariants, float64(incorrectVariants) / float64(numJobs))
    fmt.Println("Number of correctly created variants:", totalVariantCount)
    fmt.Println("Incorrect price/stock:", incorrectPriceStockCount, float64(incorrectPriceStockCount) / float64(totalVariantCount))
    fmt.Println("Correct:", correct, float64(correct) / float64(numJobs))

    if isDoFix && len(pubsubData) > 0 {
        fmt.Sprintf("Publishing %d messages", len(pubsubData))
        // golang pubsub client library seems to require project id to be specified
        projectID := os.Getenv("PROJECT_ID")
        topicID := os.Getenv("PUBSUB_PRICE_STOCK")
        err = publishToPubsub(projectID, topicID, pubsubData)
        if err != nil {
            panic(err.Error())
        }
    }
}

func handler(w http.ResponseWriter, r *http.Request) {
    run()
}

func main() {
    fmt.Println("starting server...")
    http.HandleFunc("/", handler)

    // Determine port for HTTP service.
    port := os.Getenv("PORT")
    if port == "" {
        port = "8080"
        fmt.Println("defaulting to port", port)
    }

    // Start HTTP server.
    fmt.Println("listening on port", port)
    if err := http.ListenAndServe(":"+port, nil); err != nil {
        panic(err.Error())
    }
}
