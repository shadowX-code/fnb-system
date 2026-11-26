#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>

@interface D520Reply : NSObject
@property NSMutableData *bytes;
@property BOOL channelClosed;
@end

@implementation D520Reply
- (void)rfcommChannelData:(IOBluetoothRFCOMMChannel *)channel data:(void *)data length:(size_t)length {
    if (self.bytes.length + length <= 4096) [self.bytes appendBytes:data length:length];
}
- (void)rfcommChannelClosed:(IOBluetoothRFCOMMChannel *)channel { self.channelClosed = YES; }
- (void)sdpQueryComplete:(IOBluetoothDevice *)device status:(IOReturn)status {}
@end

static void tick(void) {
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.05]];
}

static BluetoothRFCOMMChannelID serialPortChannel(IOBluetoothDevice *device) {
    IOBluetoothSDPUUID *spp = [IOBluetoothSDPUUID uuid16:0x1101];
    BluetoothRFCOMMChannelID selected = 0;
    for (IOBluetoothSDPServiceRecord *record in device.services) {
        IOBluetoothSDPDataElement *classes = [record getAttributeDataElement:1];
        if (!classes) continue;
        // This D520 advertises a lone UUID32. Other SDP records may use a sequence.
        for (IOBluetoothSDPDataElement *element in [classes getArrayValue] ?: @[classes]) {
            if (![[element getUUIDValue] isEqualToUUID:spp]) continue;
            BluetoothRFCOMMChannelID channel = 0;
            if ([record getRFCOMMChannelID:&channel] != kIOReturnSuccess || !channel) continue;
            if (selected && selected != channel) return 0;
            selected = channel;
        }
    }
    return selected;
}

static BOOL sendBytes(IOBluetoothRFCOMMChannel *channel, NSData *payload) {
    UInt16 mtu = channel.getMTU;
    if (!mtu) return NO;
    for (NSUInteger offset = 0; offset < payload.length;) {
        UInt16 count = (UInt16)MIN(payload.length - offset, mtu);
        uint8_t *pointer = (uint8_t *)payload.bytes + offset;
        if ([channel writeSync:pointer length:count] != kIOReturnSuccess) return NO;
        offset += count;
    }
    return YES;
}

static int received(D520Reply *reply, NSData *expected, NSData *rejected) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:4];
    do {
        if (rejected && [reply.bytes rangeOfData:rejected options:0 range:NSMakeRange(0, reply.bytes.length)].location != NSNotFound)
            return -1;
        if ([reply.bytes rangeOfData:expected options:0 range:NSMakeRange(0, reply.bytes.length)].location != NSNotFound)
            return 1;
        tick();
    } while (deadline.timeIntervalSinceNow > 0);
    return 0;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc == 2 && !strcmp(argv[1], "discover")) {
            for (IOBluetoothDevice *candidate in IOBluetoothDevice.pairedDevices) {
                if ([candidate.name isEqualToString:@"D520"] && candidate.addressString)
                    printf("%s\n", candidate.addressString.UTF8String);
            }
            return 0;
        }
        BOOL probe = argc >= 2 && !strcmp(argv[1], "probe");
        BOOL print = argc == 3 && !strcmp(argv[1], "print");
        if ((!probe && !print) || argc > 3) return 1;
        NSString *address = argc == 3 ? [NSString stringWithUTF8String:argv[2]] : nil;
        IOBluetoothDevice *device = nil;
        for (IOBluetoothDevice *candidate in IOBluetoothDevice.pairedDevices) {
            if (![candidate.name isEqualToString:@"D520"]) continue;
            if (address && ![candidate.addressString isEqualToString:address]) continue;
            if (device) return 2;
            device = candidate;
        }
        if (!device) return 2;
        D520Reply *reply = [D520Reply new];
        reply.bytes = [NSMutableData new];
        BluetoothRFCOMMChannelID port = serialPortChannel(device);
        if (!port && [device performSDPQuery:reply] == kIOReturnSuccess) {
            NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:10];
            do {
                tick();
                port = serialPortChannel(device);
            } while (!port && deadline.timeIntervalSinceNow > 0);
        }
        if (!port) return 3;
        IOBluetoothRFCOMMChannel *channel = nil;
        BOOL connectedBefore = [device isConnected];
        IOReturn opened = [device openRFCOMMChannelSync:&channel withChannelID:port delegate:reply];
        if (opened != kIOReturnSuccess || !channel) {
            if (probe) fprintf(stderr, "RFCOMM open failed (0x%08x); existing Bluetooth link: %s\n",
                               (unsigned int)opened, connectedBefore ? "yes" : "no");
            return 4;
        }

        int result = 5;
        if (probe) {
            NSData *query = [@"SSSGETBMAPMODE\r\n" dataUsingEncoding:NSASCIIStringEncoding];
            NSData *mode = [@"SSSGETBMAPMODE:4\r\n" dataUsingEncoding:NSASCIIStringEncoding];
            if (sendBytes(channel, query) && received(reply, mode, nil) == 1) {
                printf("%s\n", device.addressString.UTF8String);
                result = 0;
            }
        } else {
            // Write only the single job supplied by the Bridge. A NAK or missing ACK is uncertain.
            NSData *payload = [[NSFileHandle fileHandleWithStandardInput] readDataOfLength:210000];
            const uint8_t ack[] = {0x7e, 0x01, 0x7e}, nak[] = {0x7e, 0x00, 0x7e};
            if (!payload.length || payload.length >= 210000) {
                result = 9;
            } else if (!sendBytes(channel, payload)) {
                result = 6;
            } else {
                int receipt = received(reply, [NSData dataWithBytes:ack length:sizeof(ack)],
                                       [NSData dataWithBytes:nak length:sizeof(nak)]);
                result = receipt == 1 ? 0 : receipt == -1 ? 7 : 8;
            }
        }
        // Close and drain this helper's channel only. An ACL link may belong to another app.
        IOReturn closed = [channel closeChannel];
        NSDate *closeDeadline = [NSDate dateWithTimeIntervalSinceNow:1];
        while ([channel isOpen] && !reply.channelClosed && closeDeadline.timeIntervalSinceNow > 0) tick();
        if (probe && (closed != kIOReturnSuccess || [channel isOpen])) {
            fprintf(stderr, "RFCOMM owned channel did not close cleanly (0x%08x).\n", (unsigned int)closed);
            return 10;
        }
        if (probe) fprintf(stderr, "RFCOMM owned channel closed; existing Bluetooth link: %s\n",
                           connectedBefore ? "yes" : "no");
        return result;
    }
}
