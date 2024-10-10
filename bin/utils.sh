
# Color codes
DIM='\033[2m'       # Dimmed gray
NC='\033[0m'        # No Color

# Pipe your output to this function to dim it.
dim_text () {
   while IFS= read -r line; do
        echo -e "${DIM}${line}${NC}"  # Dim the output line
    done
}