//+------------------------------------------------------------------+
//|                                               HRX_2132638987.mq5 |
//|                                  Copyright 2025, MetaQuotes Ltd. |
//|                                             https://www.mql5.com |
//+------------------------------------------------------------------+
#property copyright "Copyright 2024, MQL Development"
#property link      "https://www.mqldevelopment.com/"
#property version   "2.10"

#property description "control panel and dialogue demonstration"

#include <Trade\Trade.mqh>
CTrade   trade;

#define orderNum 100

// SECURITY SETTINGS - DO NOT MODIFY
#define ALLOWED_ACCOUNT 2132638987
#define EXPIRY_DATE D'2026.04.06 23:59:59'  // 28 days from Feb 05, 2026

struct orderDetails
  {

   ulong             tckts[];
   int               lvl;


                     orderDetails()
     {

      ArrayResize(tckts,0);
      lvl = -1;

     }

  };
orderDetails od_1[orderNum];

enum frstsecn
  {
   Sym1,  // Symbol 1
   Sym2,  // Symbol 2
  };

enum tradetyp
  {
   buy,   // Buy Only
   sell,  // Sell Only
  };

input  string    settings              = " ------------- General Settings ------------- ";//_
input  int       magic_no              = 123;                  // Magic No
input  tradetyp  tradeType             = buy;                  // Open Direction
input  string    symbol1               = "XAUUSD";             // Symbol 1
input  string    symbol2               = "XAUUSD.";            // Symbol 2
input  double    initialLot            = 0.1;                  // Initial Lot
input  frstsecn  SymbolToTrade         = Sym1;                 // Symbol To Trade First when Opening
input  frstsecn  SymbolToClose         = Sym1;                 // Symbol To Close First
input  double    stopLoss              = 0;                    // StopLoss Pips
input  double    takeProfit            = 0;                    // TakeProfit Pips
input  ulong     slippageAllowed       = 1;                    // Maximum Allowed Slippage in Pips
input  bool      tradeOnSameLevel      = false;                // Enable Trade On same Level


input  string    settings1             = " ------------- Trade Trigger Settings ------------- ";//_
input  int       numberOfPairs         = 1;                    // Number Of Pairs 1
input  double    diffToTrade           = 2.4;                  // Difference To Trade 1
input  double    diffToCut             = 2.0;                  // Difference To Cut 1

input  int       numberOfPairs1        = 1;                    // Number Of Pairs 2
input  double    diffToTrade1          = 2.8;                  // Difference To Trade 2
input  double    diffToCut1            = 2.4;                  // Difference To Cut 2

input  int       numberOfPairs2        = 1;                    // Number Of Pairs 3
input  double    diffToTrade2          = 3.0;                  // Difference To Trade 3
input  double    diffToCut2            = 2.5;                  // Difference To Cut 3

input  int       numberOfPairs3        = 0;                    // Number Of Pairs 4
input  double    diffToTrade3          = 0;                    // Difference To Trade 4
input  double    diffToCut3            = 0;                    // Difference To Cut 4

input  int       numberOfPairs4        = 0;                    // Number Of Pairs 5
input  double    diffToTrade4          = 0;                    // Difference To Trade 5
input  double    diffToCut4            = 0;                    // Difference To Cut 5

input  int       numberOfPairs5        = 0;                    // Number Of Pairs 6
input  double    diffToTrade5          = 0;                    // Difference To Trade 6
input  double    diffToCut5            = 0;                    // Difference To Cut 6

input  int       numberOfPairs6        = 0;                    // Number Of Pairs 7
input  double    diffToTrade6          = 0;                    // Difference To Trade 7
input  double    diffToCut6            = 0;                    // Difference To Cut 7

input  int       numberOfPairs7        = 0;                    // Number Of Pairs 8
input  double    diffToTrade7          = 0;                    // Difference To Trade 8
input  double    diffToCut7            = 0;                    // Difference To Cut 8

input  int       numberOfPairs8        = 0;                    // Number Of Pairs 9
input  double    diffToTrade8          = 0;                    // Difference To Trade 9
input  double    diffToCut8            = 0;                    // Difference To Cut 9

input  int       numberOfPairs9        = 0;                    // Number Of Pairs 10
input  double    diffToTrade9          = 0;                    // Difference To Trade 10
input  double    diffToCut9            = 0;                    // Difference To Cut 10

input  int       numberOfPairs10       = 0;                    // Number Of Pairs 11
input  double    diffToTrade10         = 0;                    // Difference To Trade 11
input  double    diffToCut10           = 0;                    // Difference To Cut 11

// Global Variables
int totalPairs = 0;
int reason_deint = -1;

// 50ms filtering variables
ulong g_last_tick_time = 0;
int g_process_interval_ms = 50;  // 50 milliseconds

//+------------------------------------------------------------------+
//| License Check Function                                            |
//+------------------------------------------------------------------+
bool CheckLicense()
  {
   long account = AccountInfoInteger(ACCOUNT_LOGIN);
   datetime currentTime = TimeCurrent();
   
   // Check Account ID
   if(account != ALLOWED_ACCOUNT)
     {
      Alert("ERROR: This EA is licensed for account ", ALLOWED_ACCOUNT, " only!");
      Alert("Current account: ", account);
      Print("LICENSE ERROR: Unauthorized account. EA will not function.");
      return false;
     }
   
   // Check Expiry Date
   if(currentTime > EXPIRY_DATE)
     {
      Alert("ERROR: This EA license has expired!");
      Alert("Expiry date was: ", TimeToString(EXPIRY_DATE, TIME_DATE|TIME_MINUTES));
      Print("LICENSE ERROR: EA has expired. Please contact developer for renewal.");
      return false;
     }
   
   // Calculate days remaining
   int daysRemaining = int((EXPIRY_DATE - currentTime) / 86400);
   Print("LICENSE OK: ", daysRemaining, " day(s) remaining until ", TimeToString(EXPIRY_DATE, TIME_DATE));
   
   return true;
  }

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
//---
   // License Check - CRITICAL
   if(!CheckLicense())
     {
      Print("INITIALIZATION FAILED: License check failed!");
      return(INIT_FAILED);
     }
   
   Print("===========================================");
   Print("EA Licensed to Account: ", ALLOWED_ACCOUNT);
   Print("License Valid Until: ", TimeToString(EXPIRY_DATE, TIME_DATE|TIME_MINUTES));
   Print("===========================================");

   totalPairs = 0;
   if(reason_deint == 5)
     {
      clear_closed_tickets();
     }

   if(diffToTrade != 0)
     {
      totalPairs++;
     }
   if(diffToTrade1 != 0)
     {
      totalPairs++;
     }
   if(diffToTrade2 != 0)
     {
      totalPairs++;
     }
   if(diffToTrade3 != 0)
     {
      totalPairs++;
     }
   if(diffToTrade4 != 0)
     {
      totalPairs++;
     }
   if(diffToTrade5 != 0)
     {
      totalPairs++;
     }
   if(diffToTrade6 != 0)
     {
      totalPairs++;
     }
   if(diffToTrade7 != 0)
     {
      totalPairs++;
     }
   if(diffToTrade8 != 0)
     {
      totalPairs++;
     }
   if(diffToTrade9 != 0)
     {
      totalPairs++;
     }
   if(diffToTrade10 != 0)
     {
      totalPairs++;
     }


   trade.SetExpertMagicNumber(magic_no);
   trade.SetDeviationInPoints(slippageAllowed * 10);
   trade.SetTypeFilling(ORDER_FILLING_IOC);
   trade.LogLevel(LOG_LEVEL_ALL);
   trade.SetAsyncMode(false);

//---
   return(INIT_SUCCEEDED);
  }
//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
//---
   reason_deint = reason;
   Print(" Reason deInIt: ", reason_deint);
  }

//+------------------------------------------------------------------+
//| Expert tick function - MAIN LOGIC with 50ms filtering            |
//+------------------------------------------------------------------+
void OnTick()
  {
   // License Check on every tick
   if(!CheckLicense())
     {
      Alert("LICENSE VIOLATION DETECTED! EA Stopped.");
      ExpertRemove();
      return;
     }
   
   // 50ms filtering
   ulong current_tick_time = GetTickCount();
   
   if(current_tick_time - g_last_tick_time < g_process_interval_ms)
   {
      return;
   }
   g_last_tick_time = current_tick_time;

   double difference_open_buy  = NormalizeDouble(SymbolInfoDouble(symbol1,SYMBOL_ASK) - SymbolInfoDouble(symbol2,SYMBOL_BID), 2);
   double difference_open_sell = NormalizeDouble(SymbolInfoDouble(symbol1,SYMBOL_BID) - SymbolInfoDouble(symbol2,SYMBOL_ASK), 2);

   double difference_close_buy  = NormalizeDouble(SymbolInfoDouble(symbol1,SYMBOL_BID) - SymbolInfoDouble(symbol2,SYMBOL_ASK), 2);
   double difference_close_sell = NormalizeDouble(SymbolInfoDouble(symbol1,SYMBOL_ASK) - SymbolInfoDouble(symbol2,SYMBOL_BID), 2);


   if(tradeType == buy)
     {
      Print(" Difference_Open  : ",NormalizeDouble(difference_open_buy, 2)," , ",symbol1,"  ",SymbolInfoDouble(symbol1,SYMBOL_ASK)," , ",symbol2,"  ",SymbolInfoDouble(symbol2,SYMBOL_BID));
      Print(" Difference_Close : ",NormalizeDouble(difference_close_buy, 2)," , ",symbol1,"  ",SymbolInfoDouble(symbol1,SYMBOL_BID)," , ",symbol2,"  ",SymbolInfoDouble(symbol2,SYMBOL_ASK));

     }
   if(tradeType == sell)
     {
      Print(" Difference_Open  : ",NormalizeDouble(difference_open_sell, 2)," , ",symbol1,"  ",SymbolInfoDouble(symbol1,SYMBOL_BID)," , ",symbol2,"  ",SymbolInfoDouble(symbol2,SYMBOL_ASK));
      Print(" Difference_Close : ",NormalizeDouble(difference_close_sell, 2)," , ",symbol1,"  ",SymbolInfoDouble(symbol1,SYMBOL_ASK)," , ",symbol2,"  ",SymbolInfoDouble(symbol2,SYMBOL_BID));

     }



   Print(" Pair 0  :  " + string(get_level_trades_pair(0))  + "/", numberOfPairs,   " (Trade : ",diffToTrade,   " Cut : ",diffToCut,   ")");
   Print(" Pair 1  :  " + string(get_level_trades_pair(1))  + "/", numberOfPairs1,  " (Trade : ",diffToTrade1,  " Cut : ",diffToCut1,  ")");
   Print(" Pair 2  :  " + string(get_level_trades_pair(2))  + "/", numberOfPairs2,  " (Trade : ",diffToTrade2,  " Cut : ",diffToCut2,  ")");
   Print(" Pair 3  :  " + string(get_level_trades_pair(3))  + "/", numberOfPairs3,  " (Trade : ",diffToTrade3,  " Cut : ",diffToCut3,  ")");
   Print(" Pair 4  :  " + string(get_level_trades_pair(4))  + "/", numberOfPairs4,  " (Trade : ",diffToTrade4,  " Cut : ",diffToCut4,  ")");
   Print(" Pair 5  :  " + string(get_level_trades_pair(5))  + "/", numberOfPairs5,  " (Trade : ",diffToTrade5,  " Cut : ",diffToCut5,  ")");
   Print(" Pair 6  :  " + string(get_level_trades_pair(6))  + "/", numberOfPairs6,  " (Trade : ",diffToTrade6,  " Cut : ",diffToCut6,  ")");
   Print(" Pair 7  :  " + string(get_level_trades_pair(7))  + "/", numberOfPairs7,  " (Trade : ",diffToTrade7,  " Cut : ",diffToCut7,  ")");
   Print(" Pair 8  :  " + string(get_level_trades_pair(8))  + "/", numberOfPairs8,  " (Trade : ",diffToTrade8,  " Cut : ",diffToCut8,  ")");
   Print(" Pair 9  :  " + string(get_level_trades_pair(9))  + "/", numberOfPairs9,  " (Trade : ",diffToTrade9,  " Cut : ",diffToCut9,  ")");
   Print(" Pair 10 :  " + string(get_level_trades_pair(10)) + "/", numberOfPairs10, " (Trade : ",diffToTrade10, " Cut : ",diffToCut10, ")");

   Print(" Total Pairs: " + string(get_level_trades_pair(0) + get_level_trades_pair(1) + get_level_trades_pair(2) + get_level_trades_pair(3) + get_level_trades_pair(4) + get_level_trades_pair(5) + get_level_trades_pair(6) + get_level_trades_pair(7) + get_level_trades_pair(8) + get_level_trades_pair(9) + get_level_trades_pair(10)) +
         "/" + string(totalPairs));

   if(diffToTrade != 0)
     {
      placeTrade(numberOfPairs,diffToTrade,0,difference_open_buy,difference_open_sell);
     }
   if(diffToTrade1 != 0)
     {
      placeTrade(numberOfPairs1,diffToTrade1,1,difference_open_buy,difference_open_sell);
     }
   if(diffToTrade2 != 0)
     {
      placeTrade(numberOfPairs2,diffToTrade2,2,difference_open_buy,difference_open_sell);
     }
   if(diffToTrade3 != 0)
     {
      placeTrade(numberOfPairs3,diffToTrade3,3,difference_open_buy,difference_open_sell);
     }
   if(diffToTrade4 != 0)
     {
      placeTrade(numberOfPairs4,diffToTrade4,4,difference_open_buy,difference_open_sell);
     }
   if(diffToTrade5 != 0)
     {
      placeTrade(numberOfPairs5,diffToTrade5,5,difference_open_buy,difference_open_sell);
     }
   if(diffToTrade6 != 0)
     {
      placeTrade(numberOfPairs6,diffToTrade6,6,difference_open_buy,difference_open_sell);
     }
   if(diffToTrade7 != 0)
     {
      placeTrade(numberOfPairs7,diffToTrade7,7,difference_open_buy,difference_open_sell);
     }
   if(diffToTrade8 != 0)
     {
      placeTrade(numberOfPairs8,diffToTrade8,8,difference_open_buy,difference_open_sell);
     }
   if(diffToTrade9 != 0)
     {
      placeTrade(numberOfPairs9,diffToTrade9,9,difference_open_buy,difference_open_sell);
     }
   if(diffToTrade10 != 0)
     {
      placeTrade(numberOfPairs10,diffToTrade10,10,difference_open_buy,difference_open_sell);
     }

   if(diffToCut != 0)
     {
      closeTrade(diffToCut,0,difference_close_buy,difference_close_sell);
     }
   if(diffToCut1 != 0)
     {
      closeTrade(diffToCut1,1,difference_close_buy,difference_close_sell);
     }
   if(diffToCut2 != 0)
     {
      closeTrade(diffToCut2,2,difference_close_buy,difference_close_sell);
     }
   if(diffToCut3 != 0)
     {
      closeTrade(diffToCut3,3,difference_close_buy,difference_close_sell);
     }
   if(diffToCut4 != 0)
     {
      closeTrade(diffToCut4,4,difference_close_buy,difference_close_sell);
     }
   if(diffToCut5 != 0)
     {
      closeTrade(diffToCut5,5,difference_close_buy,difference_close_sell);
     }
   if(diffToCut6 != 0)
     {
      closeTrade(diffToCut6,6,difference_close_buy,difference_close_sell);
     }
   if(diffToCut7 != 0)
     {
      closeTrade(diffToCut7,7,difference_close_buy,difference_close_sell);
     }
   if(diffToCut8 != 0)
     {
      closeTrade(diffToCut8,8,difference_close_buy,difference_close_sell);
     }
   if(diffToCut9 != 0)
     {
      closeTrade(diffToCut9,9,difference_close_buy,difference_close_sell);
     }
   if(diffToCut10 != 0)
     {
      closeTrade(diffToCut10,10,difference_close_buy,difference_close_sell);
     }
  }

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void closeTrade(double difftoCutTrade,int lvl,double difference_close_buy,double difference_close_sell)
  {

   double difference_close = 0;

   if(tradeType == buy)
     {
      difference_close = difference_close_buy;
     }
   if(tradeType == sell)
     {
      difference_close = difference_close_sell;
     }

   string sym1 = symbol1;
   string sym2 = symbol2;

   if(SymbolToClose == Sym2)
     {
      sym1 = symbol2;
      sym2 = symbol1;
     }

   if((difference_close < difftoCutTrade && tradeType == sell) || (difference_close > difftoCutTrade && tradeType == buy))
     {
      close_trade_place_on_that_level(lvl,sym1,sym2);
      // Print("  Level  = ",lvl," Difference to cut = ",difftoCutTrade," Current Diiference = ",difference_close);
     }


  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
bool placeTrade(int numberOfPair,double difftoTrade,int level,double difference_open_buy,double difference_open_sell)
  {

   double difference_open = 0;

   if(tradeType == buy)
     {
      difference_open = difference_open_buy;
     }
   if(tradeType == sell)
     {
      difference_open = difference_open_sell;
     }

   string sym1 = symbol1;
   string sym2 = symbol2;

//if(SymbolToTrade == Sym2)
//  {
//   sym1 = symbol2;
//   sym2 = symbol1;
//  }

   if((tradeType == buy && difference_open < difftoTrade) || (tradeType == sell && difference_open > difftoTrade))
     {

      if(check_trade_place_on_that_level(level) == false)
        {

         if(tradeType == buy)
           {
            for(int i = 0;i < numberOfPair; i++)
              {
               Print("  Level  = ",level," Difference to Place Trade = ",difftoTrade," Current Diiference = ",difference_open);
               ulong tckt = -1, tckt1 = -1;
               if(SymbolToTrade == Sym1)
                 {
                  tckt  = placeBuyTrade(sym1);
                  tckt1 = placeSellTrade(sym2);
                 }
               if(SymbolToTrade == Sym2)
                 {
                  tckt1 = placeSellTrade(sym2);
                  tckt  = placeBuyTrade(sym1);
                 }

               if(tckt != -1 && tckt1 != -1)
                 {
                  level_trade_add_to_structure(level,tckt);
                  level_trade_add_to_structure(level,tckt1);
                 }
              }

            return true;
           }

         if(tradeType == sell)
           {
            for(int i = 0;i < numberOfPair; i++)
              {
               Print("  Level  = ",level," Difference to Place Trade = ",difftoTrade," Current Diiference = ",difference_open);

               //ulong tckt  = placeSellTrade(sym1);
               //ulong tckt1 = placeBuyTrade(sym2);

               ulong tckt = -1, tckt1 = -1;
               if(SymbolToTrade == Sym1)
                 {
                  tckt  = placeSellTrade(sym1);
                  tckt1 = placeBuyTrade(sym2);
                 }
               if(SymbolToTrade == Sym2)
                 {
                  tckt1 = placeBuyTrade(sym2);
                  tckt  = placeSellTrade(sym1);
                 }

               if(tckt != -1 && tckt1 != -1)
                 {
                  level_trade_add_to_structure(level,tckt);
                  level_trade_add_to_structure(level,tckt1);
                 }
              }
            return true;
           }

        }

     }
   return false;
  }

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void level_trade_add_to_structure(int level,ulong tckt)
  {

   for(int i=0; i<orderNum; i++)
     {
      if(od_1[i].lvl == -1 || od_1[i].lvl == level)
        {
         od_1[i].lvl = level;

         ArrayResize(od_1[i].tckts,ArraySize(od_1[i].tckts) + 1);
         od_1[i].tckts[ArraySize(od_1[i].tckts) - 1] = tckt;

         Print(" Trade Ticket ",od_1[i].tckts[ArraySize(od_1[i].tckts) - 1]," Of lvl ",level," Is Added to Struct "," Array Size = ",ArraySize(od_1[i].tckts));
         break;
        }

     }

  }


//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void remove_from_structure()
  {

   for(int i=0; i<orderNum; i++)
     {
      if(od_1[i].lvl != -1)
        {
         od_1[i].lvl = -1;
         ArrayResize(od_1[i].tckts,0);
        }

     }

  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
ulong placeBuyTrade(string symbol)
  {

   double price  = SymbolInfoDouble(symbol,SYMBOL_ASK);
   double buySl = 0,buyTp = 0;

   if(stopLoss != 0)
     {
      buySl  = price - stopLoss*10*SymbolInfoDouble(symbol,SYMBOL_POINT);
     }

   if(takeProfit != 0)
     {
      buyTp  = price + takeProfit*10*SymbolInfoDouble(symbol,SYMBOL_POINT);
     }

   if(trade.Buy(initialLot,symbol,price,buySl,buyTp,""))
     {
      Print(" Buy Trade Placed: ",trade.ResultOrder());
      return trade.ResultOrder();
     }
   else
     {
      Print(" Error in placing Buy Trade : ",GetLastError());
     }
   return -1;
  }

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
ulong placeSellTrade(string symbol)
  {

   double price  = SymbolInfoDouble(symbol,SYMBOL_BID);
   double sellSl = 0,sellTp = 0;

   if(takeProfit != 0)
     {
      sellTp  = price - takeProfit*10*SymbolInfoDouble(symbol,SYMBOL_POINT);
     }
   if(stopLoss != 0)
     {
      sellSl  = price + stopLoss*10*SymbolInfoDouble(symbol,SYMBOL_POINT);
     }

   if(trade.Sell(initialLot,symbol,price,sellSl,sellTp,""))
     {
      Print(" Sell Trade Placed: ",trade.ResultOrder());
      return trade.ResultOrder();
     }
   else
     {
      Print(" Error in placing Sell Trade : ",GetLastError());
     }
   return -1;
  }


//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void closeAllTrades()
  {


   for(int i= PositionsTotal()-1; i>=0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket))
        {

         if(PositionGetInteger(POSITION_MAGIC) == magic_no && (PositionGetString(POSITION_SYMBOL) == symbol1 || PositionGetString(POSITION_SYMBOL) == symbol2))
           {
            if(!trade.PositionClose(PositionGetInteger(POSITION_TICKET)))
              {Print("Problem in closing order by closeAllActivePendingOrders(). Ticket: ", PositionGetInteger(POSITION_TICKET), " Error: ", GetLastError()); }
            else
              {
               Print("Order Closed by closeAllActivePendingOrders(). ", PositionGetInteger(POSITION_TICKET));
              }
           }

        }
     }


  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
bool close_trade_place_on_that_level(int level,string sym1,string sym2)
  {

   for(int i=0; i<orderNum; i++)
     {
      if(od_1[i].lvl == level && ArraySize(od_1[i].tckts) != 0)
        {

         for(int j = 0;j < ArraySize(od_1[i].tckts);j++)
           {

            ulong tckt = od_1[i].tckts[j];

            if(PositionSelectByTicket(tckt))
              {
               if(PositionGetString(POSITION_SYMBOL) == sym1)
                 {
                  if(!trade.PositionClose(od_1[i].tckts[j]))
                    {
                     Print("Problem in closing order order by close_trade_place_on_that_level(). Ticket: ",od_1[i].tckts[j], " Error: ", GetLastError());
                    }
                  else
                    {
                     Print("Order Closed by close_trade_place_on_that_level(). Ticket: ", od_1[i].tckts[j]);
                    }
                 }
              }
           }

         for(int j = 0;j < ArraySize(od_1[i].tckts);j++)
           {

            ulong tckt = od_1[i].tckts[j];

            if(PositionSelectByTicket(tckt))
              {
               if(!trade.PositionClose(od_1[i].tckts[j]))
                 {
                  Print("Problem in closing order order by close_trade_place_on_that_level. Ticket: ", od_1[i].tckts[j], " Error: ", GetLastError());
                 }
               else
                 {
                  Print("Order Closed by close_trade_place_on_that_level(). Ticket: ", od_1[i].tckts[j]);
                 }
              }
           }

         if(tradeOnSameLevel)
           {
            ArrayResize(od_1[i].tckts,0);
            od_1[i].lvl = -1;
           }

         return true;
        }

     }

   return false;
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
void clear_closed_tickets()
  {
// Iterate through each order descriptor
   for(int i = 0; i < orderNum; i++)
     {
      int ticketCount = ArraySize(od_1[i].tckts);
      // Process only if there are tickets stored
      if(od_1[i].lvl != -1 && ticketCount > 0)
        {
         bool anyOpen = false;
         // Check each stored ticket for an open position
         for(int j = 0; j < ticketCount; j++)
           {
            ulong ticket = od_1[i].tckts[j];
            if(PositionSelectByTicket(ticket))
              {
               Print(" Ticket Present not removing it from structure: ", ticket);
               anyOpen = true;
               break;  // At least one is still open
              }
           }

         // If none of the tickets are open, clear the array and reset level
         if(!anyOpen)
           {
            ArrayResize(od_1[i].tckts, 0);
            od_1[i].lvl = -1;
           }
        }
     }
  }

//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
int getActiveOrdersCount(ulong & tckts[])
  {

   int count = 0;

   for(int k = 0; k < ArraySize(tckts); k++)
     {
      if(PositionSelectByTicket(tckts[k]))
        {
         count++;
        }
     }
   return count;
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
int get_level_trades_pair(int level)
  {

   for(int i=0; i<orderNum; i++)
     {
      if(od_1[i].lvl == level && ArraySize(od_1[i].tckts) != 0)
        {
         int count = getActiveOrdersCount(od_1[i].tckts);

         return int(count/2);
        }

     }
   return 0;
  }
//+------------------------------------------------------------------+
//|                                                                  |
//+------------------------------------------------------------------+
bool check_trade_place_on_that_level(int level)
  {

   for(int i=0; i<orderNum; i++)
     {
      if(od_1[i].lvl == level && ArraySize(od_1[i].tckts) != 0)
        {
         return true;
        }

     }
   return false;
  }
//+------------------------------------------------------------------+